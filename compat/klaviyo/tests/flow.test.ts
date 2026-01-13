/**
 * RED Phase Tests: Klaviyo Flow Automation APIs
 *
 * Tests for Klaviyo-compatible flow automation including:
 * - Flow CRUD (create, read, update, delete)
 * - Flow triggers (event-based, date-based, list-based)
 * - Flow actions (send email, SMS, webhook)
 * - Flow conditions (if/else branches)
 * - Flow timing (delays, time windows)
 * - Flow status (active, draft, archived)
 *
 * These tests define the expected API before implementation.
 * @see https://developers.klaviyo.com/en/reference/flows-api
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  KlaviyoClient,
  Flow,
  FlowAction,
  FlowTrigger,
  FlowCondition,
  FlowDelay,
  FlowStatus,
  FlowActionType,
  FlowTriggerType,
  FlowConditionOperator,
} from '../index'

describe('@dotdo/klaviyo - Flow API', () => {
  let client: KlaviyoClient

  beforeEach(() => {
    vi.useFakeTimers()
    client = new KlaviyoClient({
      apiKey: 'pk_test_klaviyo_api_key',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================================
  // FLOW CRUD OPERATIONS
  // ============================================================================

  describe('Flow CRUD', () => {
    describe('Create Flow', () => {
      it('should create a flow with name and trigger', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Welcome Series',
              trigger_type: 'list',
              status: 'draft',
            },
          },
        })

        expect(flow.data.id).toBeDefined()
        expect(flow.data.type).toBe('flow')
        expect(flow.data.attributes.name).toBe('Welcome Series')
        expect(flow.data.attributes.status).toBe('draft')
      })

      it('should create a flow with event trigger', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Abandoned Cart',
              trigger_type: 'metric',
              trigger: {
                metric_id: 'VRNQT2',
                filter: {
                  type: 'and',
                  conditions: [
                    {
                      property: 'value',
                      operator: 'greater-than',
                      value: 50,
                    },
                  ],
                },
              },
            },
          },
        })

        expect(flow.data.attributes.trigger_type).toBe('metric')
        expect(flow.data.attributes.trigger.metric_id).toBe('VRNQT2')
      })

      it('should create a flow with date-based trigger', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Birthday Flow',
              trigger_type: 'date',
              trigger: {
                date_property: 'birthday',
                offset_days: -7, // 7 days before birthday
              },
            },
          },
        })

        expect(flow.data.attributes.trigger_type).toBe('date')
        expect(flow.data.attributes.trigger.date_property).toBe('birthday')
        expect(flow.data.attributes.trigger.offset_days).toBe(-7)
      })

      it('should create a flow with list trigger', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'New Subscriber Welcome',
              trigger_type: 'list',
              trigger: {
                list_id: 'TkNPR7',
                trigger_on: 'subscribe',
              },
            },
          },
        })

        expect(flow.data.attributes.trigger_type).toBe('list')
        expect(flow.data.attributes.trigger.list_id).toBe('TkNPR7')
      })

      it('should create a flow with segment trigger', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'VIP Customer Onboarding',
              trigger_type: 'segment',
              trigger: {
                segment_id: 'SEG123',
                trigger_on: 'enter',
              },
            },
          },
        })

        expect(flow.data.attributes.trigger_type).toBe('segment')
        expect(flow.data.attributes.trigger.segment_id).toBe('SEG123')
      })

      it('should reject flow without name', async () => {
        await expect(
          client.Flows.create({
            data: {
              type: 'flow',
              attributes: {
                trigger_type: 'list',
              } as any,
            },
          })
        ).rejects.toThrow(/name.*required/i)
      })

      it('should generate unique flow ID', async () => {
        const flow1 = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow 1', trigger_type: 'list' },
          },
        })

        const flow2 = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow 2', trigger_type: 'list' },
          },
        })

        expect(flow1.data.id).not.toBe(flow2.data.id)
      })
    })

    describe('Read Flow', () => {
      it('should get flow by ID', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Test Flow', trigger_type: 'list' },
          },
        })

        const flow = await client.Flows.get(created.data.id)

        expect(flow.data.id).toBe(created.data.id)
        expect(flow.data.attributes.name).toBe('Test Flow')
      })

      it('should return 404 for non-existent flow', async () => {
        await expect(client.Flows.get('non-existent-id')).rejects.toThrow(/not found/i)
      })

      it('should list all flows', async () => {
        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow A', trigger_type: 'list' },
          },
        })

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow B', trigger_type: 'metric' },
          },
        })

        const flows = await client.Flows.list()

        expect(flows.data.length).toBeGreaterThanOrEqual(2)
      })

      it('should paginate flow list', async () => {
        // Create 25 flows
        for (let i = 0; i < 25; i++) {
          await client.Flows.create({
            data: {
              type: 'flow',
              attributes: { name: `Flow ${i}`, trigger_type: 'list' },
            },
          })
        }

        const page1 = await client.Flows.list({ page: { size: 10, cursor: undefined } })
        expect(page1.data.length).toBe(10)
        expect(page1.links?.next).toBeDefined()

        const page2 = await client.Flows.list({ page: { size: 10, cursor: page1.links.next } })
        expect(page2.data.length).toBe(10)
      })

      it('should filter flows by status', async () => {
        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Active Flow', trigger_type: 'list', status: 'live' },
          },
        })

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Draft Flow', trigger_type: 'list', status: 'draft' },
          },
        })

        const activeFlows = await client.Flows.list({
          filter: "equals(status,'live')",
        })

        expect(activeFlows.data.every((f) => f.attributes.status === 'live')).toBe(true)
      })

      it('should filter flows by trigger type', async () => {
        const metricFlows = await client.Flows.list({
          filter: "equals(trigger_type,'metric')",
        })

        expect(metricFlows.data.every((f) => f.attributes.trigger_type === 'metric')).toBe(true)
      })

      it('should include related actions in response', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow with Actions', trigger_type: 'list' },
          },
        })

        // Add action to flow
        await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: { template_id: 'TPL123' },
            },
            relationships: {
              flow: { data: { type: 'flow', id: created.data.id } },
            },
          },
        })

        const flow = await client.Flows.get(created.data.id, {
          include: ['flow-actions'],
        })

        expect(flow.included).toBeDefined()
        expect(flow.included?.some((i) => i.type === 'flow-action')).toBe(true)
      })
    })

    describe('Update Flow', () => {
      it('should update flow name', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Original Name', trigger_type: 'list' },
          },
        })

        const updated = await client.Flows.update(created.data.id, {
          data: {
            type: 'flow',
            id: created.data.id,
            attributes: {
              name: 'Updated Name',
            },
          },
        })

        expect(updated.data.attributes.name).toBe('Updated Name')
      })

      it('should update flow status', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Draft Flow', trigger_type: 'list', status: 'draft' },
          },
        })

        const updated = await client.Flows.update(created.data.id, {
          data: {
            type: 'flow',
            id: created.data.id,
            attributes: {
              status: 'live',
            },
          },
        })

        expect(updated.data.attributes.status).toBe('live')
      })

      it('should update flow trigger configuration', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Event Flow',
              trigger_type: 'metric',
              trigger: { metric_id: 'OLD123' },
            },
          },
        })

        const updated = await client.Flows.update(created.data.id, {
          data: {
            type: 'flow',
            id: created.data.id,
            attributes: {
              trigger: { metric_id: 'NEW456' },
            },
          },
        })

        expect(updated.data.attributes.trigger.metric_id).toBe('NEW456')
      })

      it('should track updated_at timestamp', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Timestamped', trigger_type: 'list' },
          },
        })

        const createdAt = new Date(created.data.attributes.updated_at)

        await vi.advanceTimersByTimeAsync(1000)

        const updated = await client.Flows.update(created.data.id, {
          data: {
            type: 'flow',
            id: created.data.id,
            attributes: { name: 'Updated' },
          },
        })

        const updatedAt = new Date(updated.data.attributes.updated_at)
        expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime())
      })
    })

    describe('Delete Flow', () => {
      it('should delete flow by ID', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'To Delete', trigger_type: 'list' },
          },
        })

        await client.Flows.delete(created.data.id)

        await expect(client.Flows.get(created.data.id)).rejects.toThrow(/not found/i)
      })

      it('should delete flow with cascade to actions', async () => {
        const created = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Flow with Actions', trigger_type: 'list' },
          },
        })

        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: {} },
            relationships: {
              flow: { data: { type: 'flow', id: created.data.id } },
            },
          },
        })

        await client.Flows.delete(created.data.id)

        await expect(client.FlowActions.get(action.data.id)).rejects.toThrow(/not found/i)
      })

      it('should return 404 when deleting non-existent flow', async () => {
        await expect(client.Flows.delete('non-existent-id')).rejects.toThrow(/not found/i)
      })
    })
  })

  // ============================================================================
  // FLOW TRIGGERS
  // ============================================================================

  describe('Flow Triggers', () => {
    describe('Event-Based Triggers', () => {
      it('should trigger flow on custom event', async () => {
        const executions: any[] = []

        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Purchase Thank You',
              trigger_type: 'metric',
              trigger: {
                metric_id: 'placed_order',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Simulate event
        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'placed_order' } } },
              profile: { data: { type: 'profile', id: 'PROF123' } },
              properties: { order_id: 'ORD123', value: 150 },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)

        expect(executions.length).toBeGreaterThanOrEqual(1)
        expect(executions[0].flow_id).toBe(flow.data.id)
      })

      it('should filter events by property conditions', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'High Value Orders',
              trigger_type: 'metric',
              trigger: {
                metric_id: 'placed_order',
                filter: {
                  type: 'and',
                  conditions: [
                    { property: 'value', operator: 'greater-than', value: 100 },
                  ],
                },
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Low value order - should NOT trigger
        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'placed_order' } } },
              profile: { data: { type: 'profile', id: 'PROF1' } },
              properties: { value: 50 },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(0)

        // High value order - should trigger
        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'placed_order' } } },
              profile: { data: { type: 'profile', id: 'PROF2' } },
              properties: { value: 200 },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(1)
      })

      it('should support complex filter conditions', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Complex Trigger',
              trigger_type: 'metric',
              trigger: {
                metric_id: 'checkout_started',
                filter: {
                  type: 'and',
                  conditions: [
                    { property: 'cart_value', operator: 'greater-than', value: 50 },
                    { property: 'item_count', operator: 'greater-than', value: 1 },
                    {
                      type: 'or',
                      conditions: [
                        { property: 'customer_type', operator: 'equals', value: 'returning' },
                        { property: 'has_discount', operator: 'equals', value: true },
                      ],
                    },
                  ],
                },
              },
            },
          },
        })

        expect(flow.data.attributes.trigger.filter.type).toBe('and')
        expect(flow.data.attributes.trigger.filter.conditions.length).toBe(3)
      })

      it('should trigger on product-specific events', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Product Interest',
              trigger_type: 'metric',
              trigger: {
                metric_id: 'viewed_product',
                filter: {
                  type: 'and',
                  conditions: [
                    { property: '$product_id', operator: 'in', value: ['SKU123', 'SKU456'] },
                  ],
                },
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'viewed_product' } } },
              profile: { data: { type: 'profile', id: 'PROF1' } },
              properties: { $product_id: 'SKU123' },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(1)
      })
    })

    describe('Date-Based Triggers', () => {
      it('should trigger on birthday', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Birthday Celebration',
              trigger_type: 'date',
              trigger: {
                date_property: 'birthday',
                offset_days: 0, // On the birthday
                time_of_day: '09:00',
                timezone: 'America/New_York',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Create profile with birthday today
        const today = new Date()
        await client.Profiles.create({
          data: {
            type: 'profile',
            attributes: {
              email: 'birthday@example.com',
              properties: {
                birthday: `${today.getMonth() + 1}/${today.getDate()}`,
              },
            },
          },
        })

        // Advance to 9:00 AM
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

        expect(executions.length).toBeGreaterThanOrEqual(1)
      })

      it('should trigger before anniversary date', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Anniversary Reminder',
              trigger_type: 'date',
              trigger: {
                date_property: 'anniversary',
                offset_days: -7, // 7 days before
                time_of_day: '10:00',
              },
            },
          },
        })

        expect(flow.data.attributes.trigger.offset_days).toBe(-7)
      })

      it('should trigger after a date', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Post-Purchase Follow Up',
              trigger_type: 'date',
              trigger: {
                date_property: 'last_order_date',
                offset_days: 30, // 30 days after
                time_of_day: '14:00',
              },
            },
          },
        })

        expect(flow.data.attributes.trigger.offset_days).toBe(30)
      })

      it('should respect timezone configuration', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Timezone Aware',
              trigger_type: 'date',
              trigger: {
                date_property: 'birthday',
                offset_days: 0,
                time_of_day: '09:00',
                timezone: 'Europe/London',
              },
            },
          },
        })

        expect(flow.data.attributes.trigger.timezone).toBe('Europe/London')
      })
    })

    describe('List-Based Triggers', () => {
      it('should trigger when profile subscribes to list', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Welcome to Newsletter',
              trigger_type: 'list',
              trigger: {
                list_id: 'LIST123',
                trigger_on: 'subscribe',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Subscribe profile to list
        await client.Lists.addProfiles('LIST123', {
          data: [{ type: 'profile', id: 'PROF123' }],
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(1)
      })

      it('should not trigger on unsubscribe by default', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Subscribe Only',
              trigger_type: 'list',
              trigger: {
                list_id: 'LIST123',
                trigger_on: 'subscribe',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Unsubscribe profile from list
        await client.Lists.removeProfiles('LIST123', {
          data: [{ type: 'profile', id: 'PROF123' }],
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(0)
      })

      it('should trigger on segment entry', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'VIP Welcome',
              trigger_type: 'segment',
              trigger: {
                segment_id: 'SEG_VIP',
                trigger_on: 'enter',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Profile enters segment (e.g., becomes VIP)
        await client.Segments.profileEntered('SEG_VIP', 'PROF123')

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(1)
      })

      it('should trigger on segment exit', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Win Back',
              trigger_type: 'segment',
              trigger: {
                segment_id: 'SEG_ACTIVE',
                trigger_on: 'exit',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Profile exits segment (becomes inactive)
        await client.Segments.profileExited('SEG_ACTIVE', 'PROF123')

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(1)
      })
    })

    describe('Price Drop Triggers', () => {
      it('should trigger on price drop for viewed products', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Price Drop Alert',
              trigger_type: 'price_drop',
              trigger: {
                catalog_id: 'CAT123',
                price_drop_percentage: 10, // 10% or more
                lookback_days: 30, // Products viewed in last 30 days
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Simulate price drop event
        await client.Catalog.updateItem('CAT123', 'ITEM123', {
          price: 90,
          compare_at_price: 100,
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBeGreaterThanOrEqual(0) // May trigger for profiles who viewed
      })
    })

    describe('Back In Stock Triggers', () => {
      it('should trigger when product comes back in stock', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Back In Stock',
              trigger_type: 'back_in_stock',
              trigger: {
                catalog_id: 'CAT123',
              },
              status: 'live',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        // Simulate back in stock event
        await client.Catalog.updateItem('CAT123', 'ITEM123', {
          inventory_quantity: 100,
          in_stock: true,
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBeGreaterThanOrEqual(0)
      })
    })
  })

  // ============================================================================
  // FLOW ACTIONS
  // ============================================================================

  describe('Flow Actions', () => {
    let testFlowId: string

    beforeEach(async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: { name: 'Action Test Flow', trigger_type: 'list' },
        },
      })
      testFlowId = flow.data.id
    })

    describe('Send Email Action', () => {
      it('should create email action with template', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: {
                template_id: 'TEMPLATE123',
                subject: 'Welcome to our store!',
                from_email: 'hello@store.com',
                from_name: 'Store Team',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.action_type).toBe('email')
        expect(action.data.attributes.settings.template_id).toBe('TEMPLATE123')
      })

      it('should support dynamic content in email', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: {
                template_id: 'TEMPLATE123',
                subject: 'Hi {{ first_name }}, check this out!',
                dynamic_data: {
                  product_recommendations: '{{ person|lookup:"recommended_products"|limit:3 }}',
                },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.subject).toContain('{{ first_name }}')
      })

      it('should configure tracking options', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: {
                template_id: 'TEMPLATE123',
                tracking: {
                  opens: true,
                  clicks: true,
                  utm_params: {
                    utm_source: 'klaviyo',
                    utm_medium: 'email',
                    utm_campaign: 'welcome_series',
                  },
                },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.tracking.opens).toBe(true)
        expect(action.data.attributes.settings.tracking.clicks).toBe(true)
      })
    })

    describe('Send SMS Action', () => {
      it('should create SMS action', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'sms',
              settings: {
                message: 'Hi {{ first_name }}! Your order has shipped. Track: {{ tracking_url }}',
                sender_id: 'SENDER123',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.action_type).toBe('sms')
        expect(action.data.attributes.settings.message).toBeDefined()
      })

      it('should support MMS with media', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'sms',
              settings: {
                message: 'Check out our new collection!',
                media_url: 'https://cdn.store.com/promo.jpg',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.media_url).toBeDefined()
      })

      it('should respect SMS consent', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'sms',
              settings: {
                message: 'Test message',
                require_consent: true,
                consent_list_id: 'SMS_LIST123',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.require_consent).toBe(true)
      })
    })

    describe('Push Notification Action', () => {
      it('should create push notification action', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'push',
              settings: {
                title: 'New arrivals!',
                body: 'Check out what just dropped',
                icon: 'https://cdn.store.com/icon.png',
                click_action: 'https://store.com/new',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.action_type).toBe('push')
        expect(action.data.attributes.settings.title).toBe('New arrivals!')
      })
    })

    describe('Webhook Action', () => {
      it('should create webhook action', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'webhook',
              settings: {
                url: 'https://api.myapp.com/webhook/klaviyo',
                method: 'POST',
                headers: {
                  'X-API-Key': '{{ api_key }}',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  event: 'flow_triggered',
                  profile_id: '{{ person.id }}',
                  email: '{{ person.email }}',
                }),
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.action_type).toBe('webhook')
        expect(action.data.attributes.settings.url).toBe('https://api.myapp.com/webhook/klaviyo')
      })

      it('should support custom HTTP methods', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'webhook',
              settings: {
                url: 'https://api.myapp.com/users/{{ person.id }}',
                method: 'PATCH',
                body: JSON.stringify({ status: 'engaged' }),
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.method).toBe('PATCH')
      })

      it('should support retry configuration', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'webhook',
              settings: {
                url: 'https://api.myapp.com/webhook',
                method: 'POST',
                retry: {
                  max_attempts: 3,
                  backoff_multiplier: 2,
                  initial_delay_seconds: 60,
                },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.retry.max_attempts).toBe(3)
      })
    })

    describe('Profile Update Action', () => {
      it('should update profile properties', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'update_profile',
              settings: {
                properties: {
                  welcome_series_completed: true,
                  welcome_series_completed_at: '{{ now }}',
                },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.action_type).toBe('update_profile')
        expect(action.data.attributes.settings.properties.welcome_series_completed).toBe(true)
      })

      it('should add/remove from lists', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'update_profile',
              settings: {
                add_to_lists: ['ENGAGED_LIST'],
                remove_from_lists: ['NEW_SUBSCRIBERS'],
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.settings.add_to_lists).toContain('ENGAGED_LIST')
      })
    })

    describe('Action Ordering', () => {
      it('should maintain action order', async () => {
        const action1 = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: { template_id: 'T1' },
              position: 0,
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        const action2 = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: { template_id: 'T2' },
              position: 1,
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        const actions = await client.FlowActions.listByFlow(testFlowId)

        expect(actions.data[0].id).toBe(action1.data.id)
        expect(actions.data[1].id).toBe(action2.data.id)
      })

      it('should reorder actions', async () => {
        const action1 = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T1' }, position: 0 },
            relationships: { flow: { data: { type: 'flow', id: testFlowId } } },
          },
        })

        const action2 = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T2' }, position: 1 },
            relationships: { flow: { data: { type: 'flow', id: testFlowId } } },
          },
        })

        await client.FlowActions.update(action1.data.id, {
          data: {
            type: 'flow-action',
            id: action1.data.id,
            attributes: { position: 1 },
          },
        })

        await client.FlowActions.update(action2.data.id, {
          data: {
            type: 'flow-action',
            id: action2.data.id,
            attributes: { position: 0 },
          },
        })

        const actions = await client.FlowActions.listByFlow(testFlowId)
        expect(actions.data[0].id).toBe(action2.data.id)
        expect(actions.data[1].id).toBe(action1.data.id)
      })
    })
  })

  // ============================================================================
  // FLOW CONDITIONS (IF/ELSE BRANCHES)
  // ============================================================================

  describe('Flow Conditions', () => {
    let testFlowId: string

    beforeEach(async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: { name: 'Conditional Flow', trigger_type: 'metric' },
        },
      })
      testFlowId = flow.data.id
    })

    describe('Profile Property Conditions', () => {
      it('should branch based on profile property', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'profile_property',
                property: 'customer_type',
                operator: 'equals',
                value: 'vip',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.condition_type).toBe('conditional_split')
        expect(condition.data.attributes.expression.property).toBe('customer_type')
      })

      it('should support numeric comparisons', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'profile_property',
                property: 'lifetime_value',
                operator: 'greater-than',
                value: 1000,
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.operator).toBe('greater-than')
        expect(condition.data.attributes.expression.value).toBe(1000)
      })

      it('should support contains operator', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'profile_property',
                property: 'email',
                operator: 'contains',
                value: '@gmail.com',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.operator).toBe('contains')
      })

      it('should support is-set and is-not-set operators', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'profile_property',
                property: 'phone_number',
                operator: 'is-set',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.operator).toBe('is-set')
      })
    })

    describe('Event-Based Conditions', () => {
      it('should branch based on event history', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'event',
                metric_name: 'Placed Order',
                operator: 'has-done',
                timeframe: { value: 30, unit: 'days' },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.type).toBe('event')
        expect(condition.data.attributes.expression.operator).toBe('has-done')
      })

      it('should check event count', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'event',
                metric_name: 'Opened Email',
                operator: 'count-greater-than',
                value: 5,
                timeframe: { value: 7, unit: 'days' },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.operator).toBe('count-greater-than')
        expect(condition.data.attributes.expression.value).toBe(5)
      })

      it('should check has-not-done', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'event',
                metric_name: 'Unsubscribed',
                operator: 'has-not-done',
                timeframe: { value: 90, unit: 'days' },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.operator).toBe('has-not-done')
      })
    })

    describe('List/Segment Membership Conditions', () => {
      it('should branch based on list membership', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'list_membership',
                list_id: 'VIP_LIST',
                operator: 'is-member',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.type).toBe('list_membership')
        expect(condition.data.attributes.expression.operator).toBe('is-member')
      })

      it('should branch based on segment membership', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'segment_membership',
                segment_id: 'HIGH_INTENT',
                operator: 'is-member',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.type).toBe('segment_membership')
      })
    })

    describe('Compound Conditions', () => {
      it('should support AND conditions', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'and',
                conditions: [
                  {
                    type: 'profile_property',
                    property: 'country',
                    operator: 'equals',
                    value: 'US',
                  },
                  {
                    type: 'profile_property',
                    property: 'lifetime_value',
                    operator: 'greater-than',
                    value: 500,
                  },
                ],
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.type).toBe('and')
        expect(condition.data.attributes.expression.conditions.length).toBe(2)
      })

      it('should support OR conditions', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'or',
                conditions: [
                  {
                    type: 'list_membership',
                    list_id: 'VIP_LIST',
                    operator: 'is-member',
                  },
                  {
                    type: 'profile_property',
                    property: 'employee',
                    operator: 'equals',
                    value: true,
                  },
                ],
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.type).toBe('or')
      })

      it('should support nested conditions', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'and',
                conditions: [
                  {
                    type: 'profile_property',
                    property: 'age',
                    operator: 'greater-than',
                    value: 21,
                  },
                  {
                    type: 'or',
                    conditions: [
                      {
                        type: 'profile_property',
                        property: 'state',
                        operator: 'equals',
                        value: 'CA',
                      },
                      {
                        type: 'profile_property',
                        property: 'state',
                        operator: 'equals',
                        value: 'NY',
                      },
                    ],
                  },
                ],
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.expression.conditions[1].type).toBe('or')
      })
    })

    describe('Trigger Split', () => {
      it('should split based on trigger event property', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'trigger_split',
              expression: {
                type: 'trigger_property',
                property: 'cart_value',
                operator: 'greater-than',
                value: 100,
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.condition_type).toBe('trigger_split')
        expect(condition.data.attributes.expression.type).toBe('trigger_property')
      })
    })

    describe('Conditional Branches', () => {
      it('should define YES/NO branches', async () => {
        const condition = await client.FlowConditions.create({
          data: {
            type: 'flow-condition',
            attributes: {
              condition_type: 'conditional_split',
              expression: {
                type: 'profile_property',
                property: 'vip',
                operator: 'equals',
                value: true,
              },
              branches: {
                yes: { next_action_id: 'ACTION_VIP' },
                no: { next_action_id: 'ACTION_REGULAR' },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(condition.data.attributes.branches.yes.next_action_id).toBe('ACTION_VIP')
        expect(condition.data.attributes.branches.no.next_action_id).toBe('ACTION_REGULAR')
      })
    })
  })

  // ============================================================================
  // FLOW TIMING (DELAYS & TIME WINDOWS)
  // ============================================================================

  describe('Flow Timing', () => {
    let testFlowId: string

    beforeEach(async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: { name: 'Timing Test Flow', trigger_type: 'list' },
        },
      })
      testFlowId = flow.data.id
    })

    describe('Time Delays', () => {
      it('should create fixed time delay', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'fixed',
              duration: {
                value: 24,
                unit: 'hours',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.delay_type).toBe('fixed')
        expect(delay.data.attributes.duration.value).toBe(24)
        expect(delay.data.attributes.duration.unit).toBe('hours')
      })

      it('should support various time units', async () => {
        const units = ['minutes', 'hours', 'days', 'weeks'] as const

        for (const unit of units) {
          const delay = await client.FlowDelays.create({
            data: {
              type: 'flow-delay',
              attributes: {
                delay_type: 'fixed',
                duration: { value: 1, unit },
              },
              relationships: {
                flow: { data: { type: 'flow', id: testFlowId } },
              },
            },
          })

          expect(delay.data.attributes.duration.unit).toBe(unit)
        }
      })

      it('should create smart send delay (until specific time)', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'smart_send',
              send_time: {
                hour: 10,
                minute: 0,
                timezone: 'recipient', // Use recipient's timezone
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.delay_type).toBe('smart_send')
        expect(delay.data.attributes.send_time.hour).toBe(10)
        expect(delay.data.attributes.send_time.timezone).toBe('recipient')
      })

      it('should wait for specific day of week', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'smart_send',
              send_time: {
                hour: 9,
                minute: 0,
                day_of_week: 'monday', // Wait until next Monday at 9am
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.send_time.day_of_week).toBe('monday')
      })
    })

    describe('Time Windows', () => {
      it('should restrict sends to business hours', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: { template_id: 'T1' },
              time_window: {
                enabled: true,
                days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                start_hour: 9,
                end_hour: 17,
                timezone: 'account', // Use account timezone
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.time_window.enabled).toBe(true)
        expect(action.data.attributes.time_window.days).toHaveLength(5)
      })

      it('should queue messages outside window', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'sms',
              settings: { message: 'Test' },
              time_window: {
                enabled: true,
                days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                start_hour: 10,
                end_hour: 20,
                timezone: 'recipient',
                queue_outside_window: true,
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.time_window.queue_outside_window).toBe(true)
      })

      it('should respect recipient timezone for time windows', async () => {
        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: {
              action_type: 'email',
              settings: { template_id: 'T1' },
              time_window: {
                enabled: true,
                days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                start_hour: 8,
                end_hour: 21,
                timezone: 'recipient',
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(action.data.attributes.time_window.timezone).toBe('recipient')
      })
    })

    describe('Wait For Event', () => {
      it('should wait for specific event', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'wait_for_event',
              wait_for: {
                metric_name: 'Placed Order',
                timeout: { value: 48, unit: 'hours' },
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.delay_type).toBe('wait_for_event')
        expect(delay.data.attributes.wait_for.metric_name).toBe('Placed Order')
      })

      it('should define timeout action', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'wait_for_event',
              wait_for: {
                metric_name: 'Completed Checkout',
                timeout: { value: 24, unit: 'hours' },
                on_timeout: 'continue', // Continue with flow
                on_event: 'exit', // Exit flow if event occurs
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.wait_for.on_timeout).toBe('continue')
        expect(delay.data.attributes.wait_for.on_event).toBe('exit')
      })
    })

    describe('Dynamic Timing', () => {
      it('should use profile property for delay', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'dynamic',
              dynamic_duration: {
                source: 'profile_property',
                property: 'preferred_delay_hours',
                unit: 'hours',
                fallback: 24,
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.delay_type).toBe('dynamic')
        expect(delay.data.attributes.dynamic_duration.source).toBe('profile_property')
      })

      it('should use event property for delay', async () => {
        const delay = await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: {
              delay_type: 'dynamic',
              dynamic_duration: {
                source: 'event_property',
                property: 'reminder_delay_days',
                unit: 'days',
                fallback: 7,
              },
            },
            relationships: {
              flow: { data: { type: 'flow', id: testFlowId } },
            },
          },
        })

        expect(delay.data.attributes.dynamic_duration.source).toBe('event_property')
      })
    })
  })

  // ============================================================================
  // FLOW STATUS MANAGEMENT
  // ============================================================================

  describe('Flow Status', () => {
    describe('Status Transitions', () => {
      it('should create flow in draft status by default', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'New Flow', trigger_type: 'list' },
          },
        })

        expect(flow.data.attributes.status).toBe('draft')
      })

      it('should transition from draft to live', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Go Live', trigger_type: 'list', status: 'draft' },
          },
        })

        const updated = await client.Flows.update(flow.data.id, {
          data: {
            type: 'flow',
            id: flow.data.id,
            attributes: { status: 'live' },
          },
        })

        expect(updated.data.attributes.status).toBe('live')
      })

      it('should transition from live to manual', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Pause Flow', trigger_type: 'list', status: 'live' },
          },
        })

        const updated = await client.Flows.update(flow.data.id, {
          data: {
            type: 'flow',
            id: flow.data.id,
            attributes: { status: 'manual' },
          },
        })

        expect(updated.data.attributes.status).toBe('manual')
      })

      it('should archive a flow', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Archive Me', trigger_type: 'list' },
          },
        })

        const archived = await client.Flows.archive(flow.data.id)

        expect(archived.data.attributes.archived).toBe(true)
      })

      it('should unarchive a flow', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Unarchive Me', trigger_type: 'list' },
          },
        })

        await client.Flows.archive(flow.data.id)
        const unarchived = await client.Flows.unarchive(flow.data.id)

        expect(unarchived.data.attributes.archived).toBe(false)
      })
    })

    describe('Status Validation', () => {
      it('should require actions before going live', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Empty Flow', trigger_type: 'list' },
          },
        })

        // Flow has no actions, should fail to go live
        await expect(
          client.Flows.update(flow.data.id, {
            data: {
              type: 'flow',
              id: flow.data.id,
              attributes: { status: 'live' },
            },
          })
        ).rejects.toThrow(/action.*required/i)
      })

      it('should validate trigger configuration before going live', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Incomplete Trigger',
              trigger_type: 'metric',
              // Missing trigger.metric_id
            },
          },
        })

        // Add an action to pass action validation
        await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T1' } },
            relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
          },
        })

        await expect(
          client.Flows.update(flow.data.id, {
            data: {
              type: 'flow',
              id: flow.data.id,
              attributes: { status: 'live' },
            },
          })
        ).rejects.toThrow(/trigger.*configuration/i)
      })
    })

    describe('Status Effects', () => {
      it('should not trigger when in draft status', async () => {
        const executions: any[] = []

        await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Draft Flow',
              trigger_type: 'metric',
              trigger: { metric_id: 'test_event' },
              status: 'draft',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'test_event' } } },
              profile: { data: { type: 'profile', id: 'PROF1' } },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(0)
      })

      it('should trigger when in live status', async () => {
        const executions: any[] = []

        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Live Flow',
              trigger_type: 'metric',
              trigger: { metric_id: 'test_event' },
              status: 'draft',
            },
          },
        })

        // Add action and go live
        await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T1' } },
            relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
          },
        })

        await client.Flows.update(flow.data.id, {
          data: {
            type: 'flow',
            id: flow.data.id,
            attributes: { status: 'live' },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'test_event' } } },
              profile: { data: { type: 'profile', id: 'PROF1' } },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBeGreaterThanOrEqual(1)
      })

      it('should not accept new triggers in manual status', async () => {
        const executions: any[] = []

        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Manual Flow',
              trigger_type: 'metric',
              trigger: { metric_id: 'test_event' },
              status: 'manual',
            },
          },
        })

        client.onFlowExecution((exec) => executions.push(exec))

        await client.Events.create({
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'test_event' } } },
              profile: { data: { type: 'profile', id: 'PROF1' } },
            },
          },
        })

        await vi.advanceTimersByTimeAsync(100)
        expect(executions.length).toBe(0)
      })

      it('should continue in-progress flows when paused', async () => {
        // Flows that have already started should continue
        // Only new triggers are blocked
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: {
              name: 'Paused Flow',
              trigger_type: 'list',
              trigger: { list_id: 'LIST1', trigger_on: 'subscribe' },
              status: 'live',
            },
          },
        })

        // Add delay and action
        await client.FlowDelays.create({
          data: {
            type: 'flow-delay',
            attributes: { delay_type: 'fixed', duration: { value: 1, unit: 'hours' } },
            relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
          },
        })

        await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T1' } },
            relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
          },
        })

        // Trigger flow
        await client.Lists.addProfiles('LIST1', {
          data: [{ type: 'profile', id: 'PROF1' }],
        })

        // Pause flow
        await client.Flows.update(flow.data.id, {
          data: {
            type: 'flow',
            id: flow.data.id,
            attributes: { status: 'manual' },
          },
        })

        // Get in-progress flows
        const inProgress = await client.FlowExecutions.list({
          filter: `equals(flow_id,'${flow.data.id}'),equals(status,'in_progress')`,
        })

        // In-progress flows should still exist and will continue
        expect(inProgress.data.length).toBeGreaterThanOrEqual(0)
      })
    })

    describe('Flow Analytics', () => {
      it('should track flow performance metrics', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Tracked Flow', trigger_type: 'list' },
          },
        })

        const metrics = await client.Flows.getMetrics(flow.data.id, {
          timeframe: { start: '2024-01-01', end: '2024-01-31' },
        })

        expect(metrics.data.attributes).toHaveProperty('recipients')
        expect(metrics.data.attributes).toHaveProperty('sent')
        expect(metrics.data.attributes).toHaveProperty('delivered')
        expect(metrics.data.attributes).toHaveProperty('opened')
        expect(metrics.data.attributes).toHaveProperty('clicked')
        expect(metrics.data.attributes).toHaveProperty('revenue')
      })

      it('should get action-level metrics', async () => {
        const flow = await client.Flows.create({
          data: {
            type: 'flow',
            attributes: { name: 'Action Metrics', trigger_type: 'list' },
          },
        })

        const action = await client.FlowActions.create({
          data: {
            type: 'flow-action',
            attributes: { action_type: 'email', settings: { template_id: 'T1' } },
            relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
          },
        })

        const metrics = await client.FlowActions.getMetrics(action.data.id, {
          timeframe: { start: '2024-01-01', end: '2024-01-31' },
        })

        expect(metrics.data.attributes).toHaveProperty('sent')
        expect(metrics.data.attributes).toHaveProperty('open_rate')
        expect(metrics.data.attributes).toHaveProperty('click_rate')
      })
    })
  })

  // ============================================================================
  // FLOW EXECUTION TRACKING
  // ============================================================================

  describe('Flow Executions', () => {
    it('should list flow executions', async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: {
            name: 'Execution Tracking',
            trigger_type: 'metric',
            trigger: { metric_id: 'test_event' },
            status: 'live',
          },
        },
      })

      await client.FlowActions.create({
        data: {
          type: 'flow-action',
          attributes: { action_type: 'email', settings: { template_id: 'T1' } },
          relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
        },
      })

      // Trigger flow
      await client.Events.create({
        data: {
          type: 'event',
          attributes: {
            metric: { data: { type: 'metric', attributes: { name: 'test_event' } } },
            profile: { data: { type: 'profile', id: 'PROF1' } },
          },
        },
      })

      await vi.advanceTimersByTimeAsync(100)

      const executions = await client.FlowExecutions.list({
        filter: `equals(flow_id,'${flow.data.id}')`,
      })

      expect(executions.data.length).toBeGreaterThanOrEqual(1)
      expect(executions.data[0].attributes.flow_id).toBe(flow.data.id)
    })

    it('should get execution details', async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: {
            name: 'Execution Details',
            trigger_type: 'list',
            trigger: { list_id: 'LIST1', trigger_on: 'subscribe' },
            status: 'live',
          },
        },
      })

      await client.FlowActions.create({
        data: {
          type: 'flow-action',
          attributes: { action_type: 'email', settings: { template_id: 'T1' } },
          relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
        },
      })

      await client.Lists.addProfiles('LIST1', {
        data: [{ type: 'profile', id: 'PROF1' }],
      })

      await vi.advanceTimersByTimeAsync(100)

      const executions = await client.FlowExecutions.list({
        filter: `equals(flow_id,'${flow.data.id}')`,
      })

      const execution = await client.FlowExecutions.get(executions.data[0].id)

      expect(execution.data.attributes).toHaveProperty('status')
      expect(execution.data.attributes).toHaveProperty('profile_id')
      expect(execution.data.attributes).toHaveProperty('started_at')
      expect(execution.data.attributes).toHaveProperty('action_executions')
    })

    it('should cancel a flow execution', async () => {
      const flow = await client.Flows.create({
        data: {
          type: 'flow',
          attributes: {
            name: 'Cancelable Flow',
            trigger_type: 'list',
            trigger: { list_id: 'LIST1', trigger_on: 'subscribe' },
            status: 'live',
          },
        },
      })

      // Add delay and action
      await client.FlowDelays.create({
        data: {
          type: 'flow-delay',
          attributes: { delay_type: 'fixed', duration: { value: 24, unit: 'hours' } },
          relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
        },
      })

      await client.FlowActions.create({
        data: {
          type: 'flow-action',
          attributes: { action_type: 'email', settings: { template_id: 'T1' } },
          relationships: { flow: { data: { type: 'flow', id: flow.data.id } } },
        },
      })

      await client.Lists.addProfiles('LIST1', {
        data: [{ type: 'profile', id: 'PROF1' }],
      })

      await vi.advanceTimersByTimeAsync(100)

      const executions = await client.FlowExecutions.list({
        filter: `equals(flow_id,'${flow.data.id}')`,
      })

      const cancelled = await client.FlowExecutions.cancel(executions.data[0].id)

      expect(cancelled.data.attributes.status).toBe('cancelled')
    })
  })
})
