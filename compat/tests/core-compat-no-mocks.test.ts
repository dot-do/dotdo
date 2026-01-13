/**
 * Core Compat Layer Tests - NO MOCKS
 *
 * These tests verify the core 10 compat layers work correctly using their
 * real local/in-memory implementations. Following CLAUDE.md guidance:
 * - NO mocking stores or storage
 * - Uses real implementations backed by in-memory data structures
 * - Tests actual behavior, not mock behavior
 *
 * Core 10 Compat Layers:
 * 1. Stripe - Payment processing
 * 2. HubSpot - CRM
 * 3. Zendesk - Support tickets
 * 4. Segment - Analytics
 * 5. Slack - Messaging
 * 6. Twilio - Communications
 * 7. Intercom - Customer messaging
 * 8. Shopify - E-commerce
 * 9. Redis - Caching
 * 10. S3 - Object storage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// =============================================================================
// 1. STRIPE COMPAT LAYER TESTS
// =============================================================================

describe('Stripe Compat Layer (Real Implementation)', async () => {
  const { StripeLocal } = await import('../stripe/local')
  type StripeLocalType = InstanceType<typeof StripeLocal>

  let stripe: StripeLocalType

  beforeEach(() => {
    stripe = new StripeLocal({
      webhooks: false, // Disable async webhook delivery for deterministic tests
    })
  })

  afterEach(() => {
    stripe.dispose()
  })

  describe('Customers', () => {
    it('should create and retrieve a customer', async () => {
      const customer = await stripe.customers.create({
        email: 'test@example.com',
        name: 'Test User',
        metadata: { tier: 'enterprise' },
      })

      expect(customer.id).toMatch(/^cus_/)
      expect(customer.email).toBe('test@example.com')
      expect(customer.name).toBe('Test User')
      expect(customer.metadata?.tier).toBe('enterprise')

      const retrieved = await stripe.customers.retrieve(customer.id)
      expect(retrieved.email).toBe('test@example.com')
    })

    it('should update a customer', async () => {
      const customer = await stripe.customers.create({ email: 'old@example.com' })
      const updated = await stripe.customers.update(customer.id, {
        email: 'new@example.com',
        metadata: { updated: 'true' },
      })

      expect(updated.email).toBe('new@example.com')
      expect(updated.metadata?.updated).toBe('true')
    })

    it('should delete a customer', async () => {
      const customer = await stripe.customers.create({ email: 'delete@example.com' })
      const deleted = await stripe.customers.del(customer.id)

      expect(deleted.deleted).toBe(true)
      await expect(stripe.customers.retrieve(customer.id)).rejects.toThrow()
    })

    it('should list customers with pagination', async () => {
      await stripe.customers.create({ email: 'user1@example.com' })
      await stripe.customers.create({ email: 'user2@example.com' })
      await stripe.customers.create({ email: 'user3@example.com' })

      const page1 = await stripe.customers.list({ limit: 2 })
      expect(page1.data.length).toBe(2)
      expect(page1.has_more).toBe(true)

      const page2 = await stripe.customers.list({
        limit: 2,
        starting_after: page1.data[1].id,
      })
      expect(page2.data.length).toBe(1)
    })

    it('should search customers', async () => {
      await stripe.customers.create({ email: 'alice@acme.com', name: 'Alice' })
      await stripe.customers.create({ email: 'bob@other.com', name: 'Bob' })

      const results = await stripe.customers.search({ query: 'email:"alice@acme.com"' })
      expect(results.data.length).toBe(1)
      expect(results.data[0].name).toBe('Alice')
    })
  })

  describe('Products and Prices', () => {
    it('should create products and prices', async () => {
      const product = await stripe.products.create({
        name: 'Pro Plan',
        description: 'Professional subscription',
      })

      expect(product.id).toMatch(/^prod_/)
      expect(product.name).toBe('Pro Plan')

      const price = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: 2999,
        recurring: { interval: 'month' },
      })

      expect(price.id).toMatch(/^price_/)
      expect(price.unit_amount).toBe(2999)
      expect(price.recurring?.interval).toBe('month')
    })
  })

  describe('Subscriptions', () => {
    it('should create and manage subscriptions', async () => {
      const customer = await stripe.customers.create({ email: 'sub@example.com' })
      const product = await stripe.products.create({ name: 'Monthly' })
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: 999,
        recurring: { interval: 'month' },
      })

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
      })

      expect(subscription.id).toMatch(/^sub_/)
      expect(subscription.status).toBe('active')
      expect(subscription.items.data.length).toBe(1)

      const canceled = await stripe.subscriptions.cancel(subscription.id)
      expect(canceled.status).toBe('canceled')
    })

    it('should handle subscription with trial', async () => {
      const customer = await stripe.customers.create({ email: 'trial@example.com' })
      const product = await stripe.products.create({ name: 'Trial Plan' })
      const price = await stripe.prices.create({
        product: product.id,
        currency: 'usd',
        unit_amount: 1999,
        recurring: { interval: 'month' },
      })

      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        trial_period_days: 14,
      })

      expect(subscription.status).toBe('trialing')
      expect(subscription.trial_end).toBeDefined()
    })
  })

  describe('Payment Intents (Idempotency)', () => {
    it('should create and confirm payment intents', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 5000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
      })

      expect(paymentIntent.id).toMatch(/^pi_/)
      expect(paymentIntent.status).toBe('requires_confirmation')

      const confirmed = await stripe.paymentIntents.confirm(paymentIntent.id)
      expect(confirmed.status).toBe('succeeded')
      expect(confirmed.amount_received).toBe(5000)
    })

    it('should support idempotent operations', async () => {
      const idempotencyKey = `order-${Date.now()}`

      const first = await stripe.paymentIntents.create(
        { amount: 3000, currency: 'usd' },
        { idempotencyKey }
      )

      const second = await stripe.paymentIntents.create(
        { amount: 3000, currency: 'usd' },
        { idempotencyKey }
      )

      expect(first.id).toBe(second.id)
    })

    it('should support manual capture', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 2000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
        capture_method: 'manual',
      })

      await stripe.paymentIntents.confirm(paymentIntent.id)
      const captured = await stripe.paymentIntents.capture(paymentIntent.id, {
        amount_to_capture: 1500,
      })

      expect(captured.amount_received).toBe(1500)
    })
  })

  describe('Refunds', () => {
    it('should create refunds for payment intents', async () => {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 5000,
        currency: 'usd',
        payment_method: 'pm_card_visa',
        confirm: true,
      })

      const refund = await stripe.refunds.create({
        payment_intent: paymentIntent.id,
        amount: 2500,
      })

      expect(refund.id).toMatch(/^re_/)
      expect(refund.amount).toBe(2500)
      expect(refund.status).toBe('succeeded')
    })
  })
})

// =============================================================================
// 2. HUBSPOT COMPAT LAYER TESTS
// =============================================================================

describe('HubSpot Compat Layer (Real Implementation)', async () => {
  const { HubSpotLocal } = await import('../hubspot/local')
  type HubSpotLocalType = InstanceType<typeof HubSpotLocal>

  let hubspot: HubSpotLocalType

  beforeEach(() => {
    hubspot = new HubSpotLocal()
  })

  describe('Contacts', () => {
    it('should create and retrieve contacts', async () => {
      const contact = await hubspot.crm.contacts.create({
        properties: {
          email: 'john@example.com',
          firstname: 'John',
          lastname: 'Doe',
        },
      })

      expect(contact.id).toBeDefined()
      expect(contact.properties.email).toBe('john@example.com')
      expect(contact.properties.firstname).toBe('John')

      const retrieved = await hubspot.crm.contacts.getById(contact.id)
      expect(retrieved.properties.email).toBe('john@example.com')
    })

    it('should update contacts', async () => {
      const contact = await hubspot.crm.contacts.create({
        properties: { email: 'update@example.com', firstname: 'Original' },
      })

      const updated = await hubspot.crm.contacts.update(contact.id, {
        properties: { firstname: 'Updated', company: 'Acme Inc' },
      })

      expect(updated.properties.firstname).toBe('Updated')
      expect(updated.properties.company).toBe('Acme Inc')
    })

    it('should archive contacts', async () => {
      const contact = await hubspot.crm.contacts.create({
        properties: { email: 'archive@example.com' },
      })

      await hubspot.crm.contacts.archive(contact.id)

      await expect(hubspot.crm.contacts.getById(contact.id)).rejects.toThrow()
    })

    it('should list contacts with pagination', async () => {
      await hubspot.crm.contacts.create({ properties: { email: 'a@test.com' } })
      await hubspot.crm.contacts.create({ properties: { email: 'b@test.com' } })
      await hubspot.crm.contacts.create({ properties: { email: 'c@test.com' } })

      const page1 = await hubspot.crm.contacts.getPage({ limit: 2 })
      expect(page1.results.length).toBe(2)

      if (page1.paging?.next) {
        const page2 = await hubspot.crm.contacts.getPage({
          limit: 2,
          after: page1.paging.next.after,
        })
        expect(page2.results.length).toBe(1)
      }
    })

    it('should search contacts with filters', async () => {
      await hubspot.crm.contacts.create({
        properties: { email: 'alice@acme.com', company: 'Acme' },
      })
      await hubspot.crm.contacts.create({
        properties: { email: 'bob@other.com', company: 'Other' },
      })

      const results = await hubspot.crm.contacts.search({
        filterGroups: [{
          filters: [{
            propertyName: 'company',
            operator: 'EQ',
            value: 'Acme',
          }],
        }],
      })

      expect(results.results.length).toBe(1)
      expect(results.results[0].properties.email).toBe('alice@acme.com')
    })
  })

  describe('Companies', () => {
    it('should create and manage companies', async () => {
      const company = await hubspot.crm.companies.create({
        properties: {
          name: 'Acme Corporation',
          domain: 'acme.com',
          industry: 'Technology',
        },
      })

      expect(company.id).toBeDefined()
      expect(company.properties.name).toBe('Acme Corporation')

      const updated = await hubspot.crm.companies.update(company.id, {
        properties: { numberofemployees: '100' },
      })

      expect(updated.properties.numberofemployees).toBe('100')
    })
  })

  describe('Deals', () => {
    it('should create and manage deals', async () => {
      const deal = await hubspot.crm.deals.create({
        properties: {
          dealname: 'Big Sale',
          amount: '50000',
          dealstage: 'appointmentscheduled',
        },
      })

      expect(deal.id).toBeDefined()
      expect(deal.properties.dealname).toBe('Big Sale')
      expect(deal.properties.amount).toBe('50000')

      const updated = await hubspot.crm.deals.update(deal.id, {
        properties: { dealstage: 'qualifiedtobuy' },
      })

      expect(updated.properties.dealstage).toBe('qualifiedtobuy')
    })
  })

  describe('Associations', () => {
    it('should associate contacts with companies', async () => {
      const contact = await hubspot.crm.contacts.create({
        properties: { email: 'assoc@example.com' },
      })
      const company = await hubspot.crm.companies.create({
        properties: { name: 'Test Company' },
      })

      await hubspot.crm.associations.create(
        'contacts',
        contact.id,
        'companies',
        company.id,
        'contact_to_company'
      )

      const associations = await hubspot.crm.associations.getAll(
        'contacts',
        contact.id,
        'companies'
      )

      expect(associations.results.length).toBe(1)
      expect(associations.results[0].toObjectId).toBe(company.id)
    })
  })
})

// =============================================================================
// 3. ZENDESK COMPAT LAYER TESTS
// =============================================================================

describe('Zendesk Compat Layer (Real Implementation)', async () => {
  const { ZendeskLocal } = await import('../zendesk/local')
  type ZendeskLocalType = InstanceType<typeof ZendeskLocal>

  let zendesk: ZendeskLocalType

  beforeEach(() => {
    zendesk = new ZendeskLocal({ subdomain: 'testcompany' })
  })

  describe('Tickets', () => {
    it('should create and retrieve tickets', async () => {
      const ticket = await zendesk.tickets.create({
        subject: 'Help needed',
        description: 'I have an issue with my account',
        priority: 'high',
        type: 'problem',
      })

      expect(ticket.id).toBeDefined()
      expect(ticket.subject).toBe('Help needed')
      expect(ticket.priority).toBe('high')
      expect(ticket.status).toBe('new')

      const retrieved = await zendesk.tickets.show(ticket.id)
      expect(retrieved.subject).toBe('Help needed')
    })

    it('should update ticket status and priority', async () => {
      const ticket = await zendesk.tickets.create({
        subject: 'Update test',
        description: 'Testing updates',
      })

      const updated = await zendesk.tickets.update(ticket.id, {
        status: 'open',
        priority: 'urgent',
        tags: ['vip', 'escalated'],
      })

      expect(updated.status).toBe('open')
      expect(updated.priority).toBe('urgent')
      expect(updated.tags).toContain('vip')
    })

    it('should list tickets with filtering', async () => {
      await zendesk.tickets.create({ subject: 'High 1', priority: 'high' })
      await zendesk.tickets.create({ subject: 'High 2', priority: 'high' })
      await zendesk.tickets.create({ subject: 'Low 1', priority: 'low' })

      const allTickets = await zendesk.tickets.list()
      expect(allTickets.tickets.length).toBe(3)

      const highPriority = await zendesk.tickets.list({ priority: 'high' })
      expect(highPriority.tickets.length).toBe(2)
    })

    it('should search tickets', async () => {
      await zendesk.tickets.create({
        subject: 'Password reset issue',
        description: 'Cannot reset password',
        priority: 'high',
      })
      await zendesk.tickets.create({
        subject: 'Billing question',
        description: 'Invoice unclear',
        priority: 'normal',
      })

      const results = await zendesk.tickets.search('priority:high')
      expect(results.results.length).toBe(1)
      expect(results.results[0].subject).toContain('Password')
    })
  })

  describe('Users', () => {
    it('should create and manage users', async () => {
      const user = await zendesk.users.create({
        name: 'Alice Smith',
        email: 'alice@example.com',
        role: 'end-user',
      })

      expect(user.id).toBeDefined()
      expect(user.name).toBe('Alice Smith')
      expect(user.email).toBe('alice@example.com')

      const updated = await zendesk.users.update(user.id, {
        phone: '+1234567890',
      })

      expect(updated.phone).toBe('+1234567890')
    })

    it('should search users', async () => {
      await zendesk.users.create({ name: 'John Doe', email: 'john@acme.com' })
      await zendesk.users.create({ name: 'Jane Doe', email: 'jane@other.com' })

      const results = await zendesk.users.search({ query: 'john' })
      expect(results.users.length).toBe(1)
      expect(results.users[0].email).toBe('john@acme.com')
    })
  })

  describe('Organizations', () => {
    it('should create and manage organizations', async () => {
      const org = await zendesk.organizations.create({
        name: 'Acme Inc',
        domain_names: ['acme.com'],
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Acme Inc')

      const updated = await zendesk.organizations.update(org.id, {
        notes: 'VIP customer',
      })

      expect(updated.notes).toBe('VIP customer')
    })
  })

  describe('Comments', () => {
    it('should add comments to tickets', async () => {
      const ticket = await zendesk.tickets.create({
        subject: 'Comment test',
        description: 'Initial description',
      })

      await zendesk.tickets.addComment(ticket.id, {
        body: 'First comment from agent',
        public: true,
      })

      await zendesk.tickets.addComment(ticket.id, {
        body: 'Internal note',
        public: false,
      })

      const comments = await zendesk.tickets.comments(ticket.id)
      expect(comments.comments.length).toBeGreaterThanOrEqual(2)
    })
  })
})

// =============================================================================
// 4. SEGMENT COMPAT LAYER TESTS
// =============================================================================

describe('Segment Compat Layer (Real Implementation)', async () => {
  const { Analytics, InMemoryTransport, _clear } = await import('../segment/index')
  type AnalyticsType = InstanceType<typeof Analytics>

  beforeEach(() => {
    _clear()
  })

  describe('Analytics Core', () => {
    it('should initialize with write key', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })
      expect(analytics.writeKey).toBe('test-key')
      expect(analytics.flushAt).toBe(20)
      expect(analytics.flushInterval).toBe(10000)
    })
  })

  describe('Identify', () => {
    it('should identify users', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({
        userId: 'user123',
        traits: {
          name: 'John Doe',
          email: 'john@example.com',
          plan: 'pro',
        },
      })

      const events = transport.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].type).toBe('identify')
      expect(events[0].userId).toBe('user123')
      expect(events[0].traits?.name).toBe('John Doe')
    })

    it('should auto-generate messageId and timestamp', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.identify({ userId: 'user123' })

      const events = transport.getEvents()
      expect(events[0].messageId).toBeDefined()
      expect(events[0].timestamp).toBeDefined()
    })
  })

  describe('Track', () => {
    it('should track events with properties', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.track({
        userId: 'user123',
        event: 'Order Completed',
        properties: {
          orderId: 'order_456',
          revenue: 99.99,
          currency: 'USD',
          products: [{ id: 'prod_1', name: 'Widget' }],
        },
      })

      const events = transport.getEvents()
      expect(events[0].type).toBe('track')
      expect(events[0].event).toBe('Order Completed')
      expect(events[0].properties?.revenue).toBe(99.99)
    })

    it('should require event name', () => {
      const analytics = new Analytics({ writeKey: 'test-key' })

      expect(() => {
        analytics.track({
          userId: 'user123',
          event: '', // Empty event name
        })
      }).toThrow()
    })
  })

  describe('Page and Screen', () => {
    it('should track page views', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.page({
        userId: 'user123',
        category: 'Docs',
        name: 'Getting Started',
        properties: {
          url: 'https://docs.example.com/getting-started',
        },
      })

      const events = transport.getEvents()
      expect(events[0].type).toBe('page')
      expect(events[0].category).toBe('Docs')
      expect(events[0].name).toBe('Getting Started')
    })

    it('should track screen views (mobile)', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.screen({
        userId: 'user123',
        name: 'Dashboard',
        properties: { section: 'overview' },
      })

      const events = transport.getEvents()
      expect(events[0].type).toBe('screen')
      expect(events[0].name).toBe('Dashboard')
    })
  })

  describe('Group and Alias', () => {
    it('should associate users with groups', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.group({
        userId: 'user123',
        groupId: 'company_456',
        traits: {
          name: 'Acme Inc',
          industry: 'Technology',
          employees: 100,
        },
      })

      const events = transport.getEvents()
      expect(events[0].type).toBe('group')
      expect(events[0].groupId).toBe('company_456')
      expect(events[0].traits?.name).toBe('Acme Inc')
    })

    it('should alias user IDs', () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
      })

      analytics.alias({
        userId: 'new-user-id',
        previousId: 'anon-123',
      })

      const events = transport.getEvents()
      expect(events[0].type).toBe('alias')
      expect(events[0].userId).toBe('new-user-id')
      expect(events[0].previousId).toBe('anon-123')
    })
  })

  describe('Batching', () => {
    it('should batch multiple events', async () => {
      const transport = new InMemoryTransport()
      const analytics = new Analytics({
        writeKey: 'test-key',
        transport: () => transport,
        flushAt: 100,
      })

      analytics.track({ userId: 'u1', event: 'Event 1' })
      analytics.track({ userId: 'u2', event: 'Event 2' })
      analytics.identify({ userId: 'u3', traits: { name: 'Test' } })

      await analytics.flush()

      const batches = transport.getBatches()
      expect(batches.length).toBe(1)
      expect(batches[0].batch.length).toBe(3)
    })
  })
})

// =============================================================================
// 5. SLACK COMPAT LAYER TESTS
// =============================================================================

describe('Slack Compat Layer (Real Implementation)', async () => {
  const slack = await import('../slack/index')
  const blocks = await import('../slack/blocks')

  describe('Block Kit Builder', () => {
    it('should build blocks with fluent API', () => {
      const result = new blocks.Blocks()
        .header({ text: blocks.plainText('Welcome') })
        .section({ text: blocks.mrkdwn('*Hello* world!') })
        .divider()
        .actions({
          elements: [
            blocks.button({ text: blocks.plainText('Click Me'), action_id: 'btn1' }),
          ],
        })
        .build()

      expect(result.length).toBe(4)
      expect(result[0].type).toBe('header')
      expect(result[1].type).toBe('section')
      expect(result[2].type).toBe('divider')
      expect(result[3].type).toBe('actions')
    })

    it('should create section with fields', () => {
      const section = blocks.section({
        fields: [
          blocks.mrkdwn('*Name:* John'),
          blocks.mrkdwn('*Role:* Admin'),
        ],
      })

      expect(section.type).toBe('section')
      expect(section.fields?.length).toBe(2)
    })

    it('should create buttons with styles', () => {
      const primary = blocks.button({
        text: blocks.plainText('Approve'),
        action_id: 'approve',
        style: 'primary',
      })

      const danger = blocks.button({
        text: blocks.plainText('Reject'),
        action_id: 'reject',
        style: 'danger',
      })

      expect(primary.style).toBe('primary')
      expect(danger.style).toBe('danger')
    })

    it('should create select menus', () => {
      const select = blocks.staticSelect({
        placeholder: blocks.plainText('Choose an option'),
        action_id: 'select_option',
        options: [
          blocks.option({ text: blocks.plainText('Option 1'), value: 'opt1' }),
          blocks.option({ text: blocks.plainText('Option 2'), value: 'opt2' }),
        ],
      })

      expect(select.type).toBe('static_select')
      expect(select.options?.length).toBe(2)
    })

    it('should create date and time pickers', () => {
      const datePicker = blocks.datePicker({
        action_id: 'date',
        initial_date: '2025-01-15',
      })

      const timePicker = blocks.timePicker({
        action_id: 'time',
        initial_time: '14:30',
      })

      expect(datePicker.type).toBe('datepicker')
      expect(datePicker.initial_date).toBe('2025-01-15')
      expect(timePicker.type).toBe('timepicker')
      expect(timePicker.initial_time).toBe('14:30')
    })

    it('should create input blocks', () => {
      const input = blocks.input({
        label: blocks.plainText('Email'),
        element: blocks.textInput({
          action_id: 'email_input',
          placeholder: blocks.plainText('Enter your email'),
        }),
        hint: blocks.plainText('We will never share your email'),
        optional: false,
      })

      expect(input.type).toBe('input')
      expect(input.label.text).toBe('Email')
    })
  })

  describe('SlackError', () => {
    it('should create error with code', () => {
      const error = new slack.SlackError('channel_not_found')
      expect(error.code).toBe('channel_not_found')
      expect(error.isSlackError).toBe(true)
    })
  })
})

// =============================================================================
// 6. TWILIO COMPAT LAYER TESTS
// =============================================================================

describe('Twilio Compat Layer (Real Implementation)', async () => {
  // Import the conversations module which has local implementation
  const { ConversationsLocal } = await import('../twilio/conversations')

  describe('Conversations', () => {
    let conversations: InstanceType<typeof ConversationsLocal>

    beforeEach(() => {
      conversations = new ConversationsLocal()
    })

    it('should create conversations', async () => {
      const conversation = await conversations.create({
        friendlyName: 'Support Chat',
        uniqueName: 'support-123',
      })

      expect(conversation.sid).toMatch(/^CH/)
      expect(conversation.friendlyName).toBe('Support Chat')
      expect(conversation.uniqueName).toBe('support-123')
    })

    it('should add participants to conversations', async () => {
      const conversation = await conversations.create({
        friendlyName: 'Team Chat',
      })

      const participant = await conversations.addParticipant(conversation.sid, {
        identity: 'user@example.com',
      })

      expect(participant.sid).toMatch(/^MB/)
      expect(participant.identity).toBe('user@example.com')
    })

    it('should send messages in conversations', async () => {
      const conversation = await conversations.create({
        friendlyName: 'Message Test',
      })

      await conversations.addParticipant(conversation.sid, {
        identity: 'sender@example.com',
      })

      const message = await conversations.sendMessage(conversation.sid, {
        author: 'sender@example.com',
        body: 'Hello, world!',
      })

      expect(message.sid).toMatch(/^IM/)
      expect(message.body).toBe('Hello, world!')
    })

    it('should list messages in a conversation', async () => {
      const conversation = await conversations.create({
        friendlyName: 'List Test',
      })

      await conversations.sendMessage(conversation.sid, {
        author: 'user1',
        body: 'First message',
      })

      await conversations.sendMessage(conversation.sid, {
        author: 'user2',
        body: 'Second message',
      })

      const messages = await conversations.listMessages(conversation.sid)
      expect(messages.length).toBe(2)
    })
  })
})

// =============================================================================
// 7. INTERCOM COMPAT LAYER TESTS
// =============================================================================

describe('Intercom Compat Layer (Real Implementation)', async () => {
  const { IntercomLocal } = await import('../intercom/local')
  type IntercomLocalType = InstanceType<typeof IntercomLocal>

  let intercom: IntercomLocalType

  beforeEach(() => {
    intercom = new IntercomLocal()
  })

  describe('Contacts', () => {
    it('should create and retrieve contacts', async () => {
      const contact = await intercom.contacts.create({
        role: 'user',
        email: 'contact@example.com',
        name: 'Test User',
        custom_attributes: { plan: 'pro' },
      })

      expect(contact.id).toBeDefined()
      expect(contact.email).toBe('contact@example.com')
      expect(contact.custom_attributes?.plan).toBe('pro')

      const retrieved = await intercom.contacts.find({ id: contact.id })
      expect(retrieved.email).toBe('contact@example.com')
    })

    it('should update contacts', async () => {
      const contact = await intercom.contacts.create({
        email: 'update@example.com',
      })

      const updated = await intercom.contacts.update({
        id: contact.id,
        name: 'Updated Name',
        custom_attributes: { tier: 'enterprise' },
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.custom_attributes?.tier).toBe('enterprise')
    })

    it('should list contacts with pagination', async () => {
      await intercom.contacts.create({ email: 'a@test.com' })
      await intercom.contacts.create({ email: 'b@test.com' })
      await intercom.contacts.create({ email: 'c@test.com' })

      const result = await intercom.contacts.list({ per_page: 2 })
      expect(result.data.length).toBeLessThanOrEqual(2)
    })

    it('should search contacts', async () => {
      await intercom.contacts.create({ email: 'alice@acme.com', name: 'Alice' })
      await intercom.contacts.create({ email: 'bob@other.com', name: 'Bob' })

      const results = await intercom.contacts.search({
        query: {
          field: 'email',
          operator: 'contains',
          value: 'acme',
        },
      })

      expect(results.data.length).toBe(1)
      expect(results.data[0].name).toBe('Alice')
    })
  })

  describe('Conversations', () => {
    it('should create conversations', async () => {
      const contact = await intercom.contacts.create({
        email: 'convo@example.com',
      })

      const conversation = await intercom.conversations.create({
        type: 'user',
        user: { id: contact.id },
        body: 'Hello, I need help!',
      })

      expect(conversation.id).toBeDefined()
      expect(conversation.type).toBe('conversation')
    })

    it('should reply to conversations', async () => {
      const contact = await intercom.contacts.create({
        email: 'reply@example.com',
      })

      const conversation = await intercom.conversations.create({
        type: 'user',
        user: { id: contact.id },
        body: 'Initial message',
      })

      const reply = await intercom.conversations.reply({
        id: conversation.id,
        type: 'admin',
        admin_id: 'admin_123',
        message_type: 'comment',
        body: 'Thanks for reaching out!',
      })

      expect(reply.conversation_parts.conversation_parts.length).toBeGreaterThan(0)
    })
  })

  describe('Companies', () => {
    it('should create and manage companies', async () => {
      const company = await intercom.companies.create({
        company_id: 'acme-123',
        name: 'Acme Corporation',
        plan: 'enterprise',
        custom_attributes: { industry: 'tech' },
      })

      expect(company.id).toBeDefined()
      expect(company.name).toBe('Acme Corporation')

      const updated = await intercom.companies.update({
        id: company.id,
        monthly_spend: 5000,
      })

      expect(updated.monthly_spend).toBe(5000)
    })
  })
})

// =============================================================================
// 8. SHOPIFY COMPAT LAYER TESTS
// =============================================================================

describe('Shopify Compat Layer (Real Implementation)', async () => {
  const { ShopifyLocal } = await import('../shopify/index')
  type ShopifyLocalType = InstanceType<typeof ShopifyLocal>

  let shopify: ShopifyLocalType

  beforeEach(() => {
    shopify = new ShopifyLocal({
      shop: 'test-shop.myshopify.com',
      accessToken: 'test-token',
    })
  })

  describe('Products', () => {
    it('should create and retrieve products', async () => {
      const product = await shopify.products.create({
        title: 'Test Product',
        body_html: '<p>Product description</p>',
        vendor: 'TestVendor',
        product_type: 'Widget',
        tags: 'new, featured',
      })

      expect(product.id).toBeDefined()
      expect(product.title).toBe('Test Product')
      expect(product.vendor).toBe('TestVendor')

      const retrieved = await shopify.products.get(product.id)
      expect(retrieved.title).toBe('Test Product')
    })

    it('should update products', async () => {
      const product = await shopify.products.create({
        title: 'Original Title',
      })

      const updated = await shopify.products.update(product.id, {
        title: 'Updated Title',
        tags: 'updated, modified',
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.tags).toContain('updated')
    })

    it('should list products with pagination', async () => {
      await shopify.products.create({ title: 'Product 1' })
      await shopify.products.create({ title: 'Product 2' })
      await shopify.products.create({ title: 'Product 3' })

      const result = await shopify.products.list({ limit: 2 })
      expect(result.products.length).toBe(2)
    })

    it('should delete products', async () => {
      const product = await shopify.products.create({ title: 'To Delete' })
      await shopify.products.delete(product.id)

      await expect(shopify.products.get(product.id)).rejects.toThrow()
    })
  })

  describe('Customers', () => {
    it('should create and manage customers', async () => {
      const customer = await shopify.customers.create({
        email: 'customer@example.com',
        first_name: 'John',
        last_name: 'Doe',
        phone: '+1234567890',
        tags: 'vip',
      })

      expect(customer.id).toBeDefined()
      expect(customer.email).toBe('customer@example.com')
      expect(customer.first_name).toBe('John')

      const updated = await shopify.customers.update(customer.id, {
        tags: 'vip, loyal',
        note: 'Important customer',
      })

      expect(updated.tags).toContain('loyal')
    })

    it('should search customers by email', async () => {
      await shopify.customers.create({ email: 'alice@test.com', first_name: 'Alice' })
      await shopify.customers.create({ email: 'bob@test.com', first_name: 'Bob' })

      const results = await shopify.customers.search({ query: 'email:alice@test.com' })
      expect(results.customers.length).toBe(1)
      expect(results.customers[0].first_name).toBe('Alice')
    })
  })

  describe('Orders', () => {
    it('should create orders', async () => {
      const customer = await shopify.customers.create({
        email: 'order@example.com',
      })

      const order = await shopify.orders.create({
        customer: { id: customer.id },
        line_items: [
          {
            title: 'Test Item',
            price: '29.99',
            quantity: 2,
          },
        ],
        financial_status: 'pending',
      })

      expect(order.id).toBeDefined()
      expect(order.line_items.length).toBe(1)
      expect(order.total_price).toBeDefined()
    })

    it('should update order status', async () => {
      const order = await shopify.orders.create({
        line_items: [{ title: 'Item', price: '10.00', quantity: 1 }],
        financial_status: 'pending',
      })

      const updated = await shopify.orders.update(order.id, {
        note: 'Rush delivery',
        tags: 'express',
      })

      expect(updated.note).toBe('Rush delivery')
    })
  })
})

// =============================================================================
// 9. REDIS COMPAT LAYER TESTS
// =============================================================================

describe('Redis Compat Layer (Real Implementation)', async () => {
  const { createClient, Redis } = await import('../../db/compat/cache/redis')

  describe('String Commands', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(async () => {
      client = createClient()
      await client.flushdb()
    })

    afterEach(async () => {
      await client.quit()
    })

    it('should set and get values', async () => {
      await client.set('key', 'value')
      const result = await client.get('key')
      expect(result).toBe('value')
    })

    it('should return null for non-existent keys', async () => {
      const result = await client.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should support expiration', async () => {
      await client.set('expiring', 'value', { EX: 10 })
      const ttl = await client.ttl('expiring')
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(10)
    })

    it('should increment and decrement', async () => {
      await client.set('counter', '10')
      expect(await client.incr('counter')).toBe(11)
      expect(await client.decr('counter')).toBe(10)
      expect(await client.incrby('counter', 5)).toBe(15)
    })

    it('should support MSET/MGET', async () => {
      await client.mset('k1', 'v1', 'k2', 'v2', 'k3', 'v3')
      const results = await client.mget('k1', 'k2', 'k4')
      expect(results).toEqual(['v1', 'v2', null])
    })
  })

  describe('Hash Commands', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(async () => {
      client = createClient()
      await client.flushdb()
    })

    afterEach(async () => {
      await client.quit()
    })

    it('should set and get hash fields', async () => {
      await client.hset('user', 'name', 'Alice')
      await client.hset('user', 'email', 'alice@example.com')

      expect(await client.hget('user', 'name')).toBe('Alice')
      expect(await client.hget('user', 'email')).toBe('alice@example.com')
    })

    it('should get all hash fields', async () => {
      await client.hmset('profile', { name: 'Bob', age: '30', city: 'NYC' })
      const all = await client.hgetall('profile')

      expect(all.name).toBe('Bob')
      expect(all.age).toBe('30')
      expect(all.city).toBe('NYC')
    })

    it('should increment hash field', async () => {
      await client.hset('stats', 'views', '100')
      const newVal = await client.hincrby('stats', 'views', 10)
      expect(newVal).toBe(110)
    })
  })

  describe('List Commands', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(async () => {
      client = createClient()
      await client.flushdb()
    })

    afterEach(async () => {
      await client.quit()
    })

    it('should push and pop from lists', async () => {
      await client.rpush('queue', 'a', 'b', 'c')

      expect(await client.lpop('queue')).toBe('a')
      expect(await client.rpop('queue')).toBe('c')
    })

    it('should get list range', async () => {
      await client.rpush('list', 'a', 'b', 'c', 'd', 'e')
      const range = await client.lrange('list', 1, 3)
      expect(range).toEqual(['b', 'c', 'd'])
    })

    it('should get list length', async () => {
      await client.rpush('list', 'a', 'b', 'c')
      expect(await client.llen('list')).toBe(3)
    })
  })

  describe('Set Commands', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(async () => {
      client = createClient()
      await client.flushdb()
    })

    afterEach(async () => {
      await client.quit()
    })

    it('should add and check set members', async () => {
      await client.sadd('tags', 'a', 'b', 'c')

      expect(await client.sismember('tags', 'a')).toBe(1)
      expect(await client.sismember('tags', 'd')).toBe(0)
      expect(await client.scard('tags')).toBe(3)
    })

    it('should get all set members', async () => {
      await client.sadd('set', 'x', 'y', 'z')
      const members = await client.smembers('set')
      expect(members.sort()).toEqual(['x', 'y', 'z'])
    })

    it('should perform set operations', async () => {
      await client.sadd('set1', 'a', 'b', 'c')
      await client.sadd('set2', 'b', 'c', 'd')

      const intersection = await client.sinter('set1', 'set2')
      expect(intersection.sort()).toEqual(['b', 'c'])

      const union = await client.sunion('set1', 'set2')
      expect(union.sort()).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  describe('Sorted Set Commands', () => {
    let client: ReturnType<typeof createClient>

    beforeEach(async () => {
      client = createClient()
      await client.flushdb()
    })

    afterEach(async () => {
      await client.quit()
    })

    it('should add and query sorted set members', async () => {
      await client.zadd('leaderboard', 100, 'alice', 200, 'bob', 150, 'charlie')

      expect(await client.zscore('leaderboard', 'bob')).toBe('200')
      expect(await client.zrank('leaderboard', 'alice')).toBe(0)
      expect(await client.zcard('leaderboard')).toBe(3)
    })

    it('should get range from sorted set', async () => {
      await client.zadd('scores', 1, 'a', 2, 'b', 3, 'c', 4, 'd', 5, 'e')

      const topThree = await client.zrevrange('scores', 0, 2)
      expect(topThree).toEqual(['e', 'd', 'c'])

      const bottomThree = await client.zrange('scores', 0, 2)
      expect(bottomThree).toEqual(['a', 'b', 'c'])
    })
  })
})

// =============================================================================
// 10. S3 COMPAT LAYER TESTS
// =============================================================================

describe('S3 Compat Layer (Real Implementation)', async () => {
  const { S3Local } = await import('../s3/index')
  type S3LocalType = InstanceType<typeof S3Local>

  let s3: S3LocalType

  beforeEach(() => {
    s3 = new S3Local()
  })

  describe('Bucket Operations', () => {
    it('should create and list buckets', async () => {
      await s3.createBucket({ Bucket: 'test-bucket-1' })
      await s3.createBucket({ Bucket: 'test-bucket-2' })

      const result = await s3.listBuckets({})
      expect(result.Buckets?.length).toBeGreaterThanOrEqual(2)
      expect(result.Buckets?.some(b => b.Name === 'test-bucket-1')).toBe(true)
    })

    it('should delete buckets', async () => {
      await s3.createBucket({ Bucket: 'to-delete' })
      await s3.deleteBucket({ Bucket: 'to-delete' })

      const result = await s3.listBuckets({})
      expect(result.Buckets?.some(b => b.Name === 'to-delete')).toBe(false)
    })

    it('should check bucket existence', async () => {
      await s3.createBucket({ Bucket: 'exists' })

      await expect(s3.headBucket({ Bucket: 'exists' })).resolves.toBeDefined()
      await expect(s3.headBucket({ Bucket: 'not-exists' })).rejects.toThrow()
    })
  })

  describe('Object Operations', () => {
    beforeEach(async () => {
      await s3.createBucket({ Bucket: 'test-bucket' })
    })

    it('should put and get objects', async () => {
      await s3.putObject({
        Bucket: 'test-bucket',
        Key: 'test-file.txt',
        Body: 'Hello, World!',
        ContentType: 'text/plain',
      })

      const result = await s3.getObject({
        Bucket: 'test-bucket',
        Key: 'test-file.txt',
      })

      expect(result.ContentType).toBe('text/plain')
      // Body would be a stream/buffer in real implementation
    })

    it('should list objects', async () => {
      await s3.putObject({ Bucket: 'test-bucket', Key: 'file1.txt', Body: 'a' })
      await s3.putObject({ Bucket: 'test-bucket', Key: 'file2.txt', Body: 'b' })
      await s3.putObject({ Bucket: 'test-bucket', Key: 'dir/file3.txt', Body: 'c' })

      const result = await s3.listObjectsV2({
        Bucket: 'test-bucket',
      })

      expect(result.Contents?.length).toBe(3)
    })

    it('should list objects with prefix', async () => {
      await s3.putObject({ Bucket: 'test-bucket', Key: 'images/a.jpg', Body: '' })
      await s3.putObject({ Bucket: 'test-bucket', Key: 'images/b.jpg', Body: '' })
      await s3.putObject({ Bucket: 'test-bucket', Key: 'docs/c.pdf', Body: '' })

      const result = await s3.listObjectsV2({
        Bucket: 'test-bucket',
        Prefix: 'images/',
      })

      expect(result.Contents?.length).toBe(2)
      expect(result.Contents?.every(obj => obj.Key?.startsWith('images/'))).toBe(true)
    })

    it('should delete objects', async () => {
      await s3.putObject({ Bucket: 'test-bucket', Key: 'to-delete.txt', Body: 'x' })
      await s3.deleteObject({ Bucket: 'test-bucket', Key: 'to-delete.txt' })

      await expect(s3.getObject({
        Bucket: 'test-bucket',
        Key: 'to-delete.txt',
      })).rejects.toThrow()
    })

    it('should copy objects', async () => {
      await s3.putObject({ Bucket: 'test-bucket', Key: 'source.txt', Body: 'original' })

      await s3.copyObject({
        Bucket: 'test-bucket',
        Key: 'dest.txt',
        CopySource: 'test-bucket/source.txt',
      })

      const result = await s3.getObject({
        Bucket: 'test-bucket',
        Key: 'dest.txt',
      })

      expect(result).toBeDefined()
    })
  })

  describe('Metadata Operations', () => {
    beforeEach(async () => {
      await s3.createBucket({ Bucket: 'metadata-bucket' })
    })

    it('should get object metadata', async () => {
      await s3.putObject({
        Bucket: 'metadata-bucket',
        Key: 'with-meta.txt',
        Body: 'content',
        ContentType: 'text/plain',
        Metadata: {
          'custom-key': 'custom-value',
        },
      })

      const head = await s3.headObject({
        Bucket: 'metadata-bucket',
        Key: 'with-meta.txt',
      })

      expect(head.ContentType).toBe('text/plain')
      expect(head.Metadata?.['custom-key']).toBe('custom-value')
    })
  })

  describe('Presigned URLs', () => {
    beforeEach(async () => {
      await s3.createBucket({ Bucket: 'presigned-bucket' })
      await s3.putObject({ Bucket: 'presigned-bucket', Key: 'file.txt', Body: 'data' })
    })

    it('should generate presigned GET URL', async () => {
      const url = await s3.getSignedUrl('getObject', {
        Bucket: 'presigned-bucket',
        Key: 'file.txt',
        Expires: 3600,
      })

      expect(url).toContain('presigned-bucket')
      expect(url).toContain('file.txt')
      expect(url).toContain('X-Amz-Signature')
    })

    it('should generate presigned PUT URL', async () => {
      const url = await s3.getSignedUrl('putObject', {
        Bucket: 'presigned-bucket',
        Key: 'upload.txt',
        Expires: 3600,
      })

      expect(url).toContain('presigned-bucket')
      expect(url).toContain('upload.txt')
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Cross-Compat Integration Tests', async () => {
  it('should work with Stripe + Segment for e-commerce tracking', async () => {
    const { StripeLocal } = await import('../stripe/local')
    const { Analytics, InMemoryTransport, _clear } = await import('../segment/index')

    _clear()
    const stripe = new StripeLocal({ webhooks: false })
    const transport = new InMemoryTransport()
    const analytics = new Analytics({
      writeKey: 'test-key',
      transport: () => transport,
    })

    // Create customer in Stripe
    const customer = await stripe.customers.create({
      email: 'buyer@example.com',
      name: 'Test Buyer',
    })

    // Track in Segment
    analytics.identify({
      userId: customer.id,
      traits: {
        email: customer.email,
        name: customer.name,
      },
    })

    // Process payment
    const payment = await stripe.paymentIntents.create({
      amount: 9999,
      currency: 'usd',
      customer: customer.id,
      payment_method: 'pm_card_visa',
      confirm: true,
    })

    // Track purchase
    analytics.track({
      userId: customer.id,
      event: 'Order Completed',
      properties: {
        paymentIntentId: payment.id,
        revenue: 99.99,
      },
    })

    await analytics.flush()

    const events = transport.getEvents()
    expect(events.length).toBe(2)
    expect(events[0].type).toBe('identify')
    expect(events[1].type).toBe('track')
    expect(events[1].event).toBe('Order Completed')

    stripe.dispose()
  })

  it('should work with HubSpot + Zendesk for support integration', async () => {
    const { HubSpotLocal } = await import('../hubspot/local')
    const { ZendeskLocal } = await import('../zendesk/local')

    const hubspot = new HubSpotLocal()
    const zendesk = new ZendeskLocal({ subdomain: 'test' })

    // Create contact in HubSpot
    const contact = await hubspot.crm.contacts.create({
      properties: {
        email: 'support@example.com',
        firstname: 'Support',
        lastname: 'User',
      },
    })

    // Create user in Zendesk with same email
    const user = await zendesk.users.create({
      name: `${contact.properties.firstname} ${contact.properties.lastname}`,
      email: contact.properties.email!,
    })

    // Create support ticket linked to user
    const ticket = await zendesk.tickets.create({
      subject: 'Help with my account',
      description: 'I need assistance',
      requester_id: user.id,
      priority: 'high',
    })

    expect(ticket.id).toBeDefined()
    expect(ticket.priority).toBe('high')

    // Update HubSpot contact with support info
    await hubspot.crm.contacts.update(contact.id, {
      properties: {
        hs_latest_support_ticket_id: String(ticket.id),
      },
    })

    const updatedContact = await hubspot.crm.contacts.getById(contact.id)
    expect(updatedContact.properties.hs_latest_support_ticket_id).toBe(String(ticket.id))
  })
})
