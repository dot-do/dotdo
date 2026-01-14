/**
 * Protocol Tests - TDD Red-Green-Refactor
 *
 * Protocol is the unifying abstraction that composes Pipe, Resource, Channel, and Machine
 * into a single configurable interface.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Protocol, type ProtocolInstance, type ProtocolConfig, type Connection } from '../index'
import { Pipe } from '../../pipe/index'
import { InMemoryResource } from '../../resource/index'
import { createChannel } from '../../channel/index'
import { Machine } from '../../machine/index'

// =============================================================================
// Cycle 1: Basic Protocol definition and configure()
// =============================================================================

describe('Protocol.define() and configure()', () => {
  it('should create a protocol with name and version', () => {
    const protocol = Protocol.define({
      name: 'test-protocol',
      version: '1.0.0',
    })

    expect(protocol.name).toBe('test-protocol')
    expect(protocol.version).toBe('1.0.0')
  })

  it('should create a protocol with config schema', () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      config: {
        apiKey: { type: 'string', required: true },
        webhookSecret: { type: 'string', required: false },
        timeout: { type: 'number', default: 5000 },
      },
    })

    expect(protocol.name).toBe('stripe')
    expect(protocol.version).toBe('1.0.0')
  })

  it('should validate configuration with configure()', () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      config: {
        apiKey: { type: 'string', required: true },
        timeout: { type: 'number', default: 5000 },
      },
    })

    const configured = protocol.configure({
      apiKey: 'sk_test_123',
    })

    expect(configured.config.apiKey).toBe('sk_test_123')
    expect(configured.config.timeout).toBe(5000) // Default applied
  })

  it('should throw on missing required config', () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      config: {
        apiKey: { type: 'string', required: true },
      },
    })

    expect(() => protocol.configure({})).toThrow(/apiKey.*required/i)
  })

  it('should throw on invalid config type', () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      config: {
        timeout: { type: 'number' },
      },
    })

    expect(() => protocol.configure({ timeout: 'not-a-number' as any })).toThrow(/timeout.*number/i)
  })

  it('should allow custom validator in configure()', () => {
    const protocol = Protocol.define({
      name: 'custom',
      version: '1.0.0',
      config: {
        port: {
          type: 'number',
          required: true,
          validate: (value) => value >= 1 && value <= 65535,
        },
      },
    })

    expect(() => protocol.configure({ port: 0 })).toThrow(/port.*invalid/i)
    expect(() => protocol.configure({ port: 70000 })).toThrow(/port.*invalid/i)

    const configured = protocol.configure({ port: 8080 })
    expect(configured.config.port).toBe(8080)
  })
})

// =============================================================================
// Cycle 3: Connection lifecycle (connect/disconnect)
// =============================================================================

describe('Protocol connection lifecycle', () => {
  it('should connect and return a connection', async () => {
    const protocol = Protocol.define({
      name: 'test',
      version: '1.0.0',
    })

    const configured = protocol.configure({})
    const connection = await configured.connect()

    expect(connection).toBeDefined()
    expect(connection.isConnected).toBe(true)
  })

  it('should disconnect cleanly', async () => {
    const protocol = Protocol.define({
      name: 'test',
      version: '1.0.0',
    })

    const configured = protocol.configure({})
    const connection = await configured.connect()
    await configured.disconnect()

    expect(connection.isConnected).toBe(false)
  })

  it('should support custom connect handler', async () => {
    const connectSpy = vi.fn().mockResolvedValue({ client: 'mock-client' })
    const disconnectSpy = vi.fn()

    const protocol = Protocol.define({
      name: 'db',
      version: '1.0.0',
      onConnect: connectSpy,
      onDisconnect: disconnectSpy,
    })

    const configured = protocol.configure({})
    const connection = await configured.connect()

    expect(connectSpy).toHaveBeenCalled()
    expect(connection.context.client).toBe('mock-client')

    await configured.disconnect()
    expect(disconnectSpy).toHaveBeenCalled()
  })

  it('should not allow operations before connect', async () => {
    const protocol = Protocol.define({
      name: 'test',
      version: '1.0.0',
      operations: {
        ping: { type: 'pipe', handler: async () => 'pong' },
      },
    })

    const configured = protocol.configure({})

    await expect(configured.operations.ping()).rejects.toThrow(/not connected/i)
  })
})

// =============================================================================
// Cycle 5: Operation registry
// =============================================================================

describe('Protocol operations', () => {
  it('should define pipe operations', async () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      operations: {
        echo: {
          type: 'pipe',
          handler: async (input: string) => `Echo: ${input}`,
        },
      },
    })

    const configured = protocol.configure({})
    await configured.connect()

    const result = await configured.operations.echo('hello')
    expect(result).toBe('Echo: hello')
  })

  it('should define resource operations', async () => {
    const protocol = Protocol.define({
      name: 'db',
      version: '1.0.0',
      operations: {
        users: {
          type: 'resource',
          schema: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    })

    const configured = protocol.configure({})
    await configured.connect()

    const user = await configured.operations.users.create({ name: 'John', email: 'john@test.com' })
    expect(user.id).toBeDefined()
    expect(user.name).toBe('John')

    const fetched = await configured.operations.users.get(user.id)
    expect(fetched?.email).toBe('john@test.com')
  })

  it('should define channel operations', async () => {
    const protocol = Protocol.define({
      name: 'realtime',
      version: '1.0.0',
      operations: {
        events: {
          type: 'channel',
          channelType: 'public',
        },
      },
    })

    const configured = protocol.configure({})
    await configured.connect()

    const messages: string[] = []
    configured.operations.events.subscribe('message', (data) => {
      messages.push(data as string)
    })

    await configured.operations.events.publish('message', 'hello')
    expect(messages).toContain('hello')
  })

  it('should define machine operations', async () => {
    type PaymentState = 'pending' | 'processing' | 'completed' | 'failed'
    type PaymentEvent = { type: 'PROCESS' } | { type: 'COMPLETE' } | { type: 'FAIL' }

    const protocol = Protocol.define({
      name: 'payments',
      version: '1.0.0',
      operations: {
        paymentFlow: {
          type: 'machine',
          config: {
            id: 'payment',
            initial: 'pending' as PaymentState,
            states: {
              pending: { on: { PROCESS: 'processing' } },
              processing: { on: { COMPLETE: 'completed', FAIL: 'failed' } },
              completed: { type: 'final' },
              failed: { type: 'final' },
            },
          },
        },
      },
    })

    const configured = protocol.configure({})
    await configured.connect()

    const machine = configured.operations.paymentFlow.create()
    expect(machine.state).toBe('pending')

    await machine.send({ type: 'PROCESS' })
    expect(machine.state).toBe('processing')

    await machine.send({ type: 'COMPLETE' })
    expect(machine.state).toBe('completed')
  })

  it('should support mixed operation types', async () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      operations: {
        // Pipe for one-off requests
        createCharge: {
          type: 'pipe',
          handler: async (data: { amount: number }) => ({ id: 'ch_123', ...data }),
        },
        // Resource for CRUD
        customers: {
          type: 'resource',
          schema: { email: { type: 'string' } },
        },
        // Channel for webhooks
        webhooks: {
          type: 'channel',
        },
        // Machine for payment flow
        paymentFlow: {
          type: 'machine',
          config: {
            id: 'payment',
            initial: 'pending' as const,
            states: {
              pending: { on: { START: 'processing' } },
              processing: { on: { DONE: 'completed' } },
              completed: { type: 'final' },
            },
          },
        },
      },
    })

    const configured = protocol.configure({})
    await configured.connect()

    // Use pipe
    const charge = await configured.operations.createCharge({ amount: 1000 })
    expect(charge.id).toBe('ch_123')

    // Use resource
    const customer = await configured.operations.customers.create({ email: 'test@test.com' })
    expect(customer.email).toBe('test@test.com')

    // Use channel
    let received = false
    configured.operations.webhooks.subscribe('payment', () => {
      received = true
    })
    await configured.operations.webhooks.publish('payment', { type: 'charge.succeeded' })
    expect(received).toBe(true)

    // Use machine
    const flow = configured.operations.paymentFlow.create()
    await flow.send({ type: 'START' })
    expect(flow.state).toBe('processing')
  })
})

// =============================================================================
// Cycle 7: Middleware composition
// =============================================================================

describe('Protocol middleware', () => {
  it('should add protocol-wide middleware with use()', async () => {
    const logs: string[] = []

    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      operations: {
        ping: { type: 'pipe', handler: async () => 'pong' },
        echo: { type: 'pipe', handler: async (msg: string) => msg },
      },
    })

    const configured = protocol
      .configure({})
      .use(async (ctx, next) => {
        logs.push(`before:${ctx.operation}`)
        const result = await next()
        logs.push(`after:${ctx.operation}`)
        return result
      })

    await configured.connect()

    await configured.operations.ping()
    await configured.operations.echo('hello')

    expect(logs).toEqual(['before:ping', 'after:ping', 'before:echo', 'after:echo'])
  })

  it('should compose multiple middleware in order', async () => {
    const order: number[] = []

    const protocol = Protocol.define({
      name: 'test',
      version: '1.0.0',
      operations: {
        test: { type: 'pipe', handler: async () => 'done' },
      },
    })

    const configured = protocol
      .configure({})
      .use(async (ctx, next) => {
        order.push(1)
        const result = await next()
        order.push(4)
        return result
      })
      .use(async (ctx, next) => {
        order.push(2)
        const result = await next()
        order.push(3)
        return result
      })

    await configured.connect()
    await configured.operations.test()

    expect(order).toEqual([1, 2, 3, 4])
  })

  it('should provide context in middleware', async () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      config: {
        tenant: { type: 'string', required: true },
      },
      operations: {
        getData: { type: 'pipe', handler: async () => ({ data: 'test' }) },
      },
    })

    let capturedContext: any = null

    const configured = protocol.configure({ tenant: 'acme' }).use(async (ctx, next) => {
      capturedContext = ctx
      return next()
    })

    await configured.connect()
    await configured.operations.getData()

    expect(capturedContext.operation).toBe('getData')
    expect(capturedContext.protocol).toBe('api')
    expect(capturedContext.config.tenant).toBe('acme')
  })

  it('should allow middleware to modify input/output', async () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      operations: {
        transform: { type: 'pipe', handler: async (n: number) => n * 2 },
      },
    })

    const configured = protocol.configure({}).use(async (ctx, next) => {
      // Modify input
      ctx.input = (ctx.input as number) + 10
      const result = await next()
      // Modify output
      return (result as number) + 100
    })

    await configured.connect()
    const result = await configured.operations.transform(5)

    // (5 + 10) * 2 + 100 = 130
    expect(result).toBe(130)
  })

  it('should catch and handle errors in middleware', async () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      operations: {
        fail: {
          type: 'pipe',
          handler: async () => {
            throw new Error('Original error')
          },
        },
      },
    })

    const configured = protocol.configure({}).use(async (ctx, next) => {
      try {
        return await next()
      } catch (error) {
        throw new Error(`Wrapped: ${(error as Error).message}`)
      }
    })

    await configured.connect()

    await expect(configured.operations.fail()).rejects.toThrow('Wrapped: Original error')
  })
})

// =============================================================================
// Cycle 9: Introspection (capabilities, schema)
// =============================================================================

describe('Protocol introspection', () => {
  it('should return capabilities list', () => {
    const protocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      operations: {
        charges: { type: 'pipe', handler: async () => ({}) },
        customers: { type: 'resource', schema: {} },
        webhooks: { type: 'channel' },
        paymentFlow: {
          type: 'machine',
          config: { id: 'payment', initial: 'pending', states: { pending: {} } },
        },
      },
    })

    const capabilities = protocol.capabilities()

    expect(capabilities).toContainEqual({ name: 'charges', type: 'pipe' })
    expect(capabilities).toContainEqual({ name: 'customers', type: 'resource' })
    expect(capabilities).toContainEqual({ name: 'webhooks', type: 'channel' })
    expect(capabilities).toContainEqual({ name: 'paymentFlow', type: 'machine' })
  })

  it('should return full protocol schema', () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '2.0.0',
      config: {
        apiKey: { type: 'string', required: true },
        timeout: { type: 'number', default: 5000 },
      },
      operations: {
        echo: {
          type: 'pipe',
          handler: async (msg: string) => msg,
          input: { message: { type: 'string' } },
          output: { result: { type: 'string' } },
        },
        users: {
          type: 'resource',
          schema: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      },
    })

    const schema = protocol.schema()

    expect(schema.name).toBe('api')
    expect(schema.version).toBe('2.0.0')
    expect(schema.config.apiKey).toEqual({ type: 'string', required: true })
    expect(schema.config.timeout).toEqual({ type: 'number', default: 5000 })
    expect(schema.operations.echo.type).toBe('pipe')
    expect(schema.operations.users.type).toBe('resource')
    expect(schema.operations.users.schema).toEqual({
      name: { type: 'string' },
      age: { type: 'number' },
    })
  })

  it('should include operation metadata in schema', () => {
    const protocol = Protocol.define({
      name: 'api',
      version: '1.0.0',
      operations: {
        createUser: {
          type: 'pipe',
          handler: async () => ({}),
          description: 'Creates a new user account',
          deprecated: false,
          tags: ['users', 'write'],
        },
        legacyEndpoint: {
          type: 'pipe',
          handler: async () => ({}),
          deprecated: true,
          deprecationMessage: 'Use newEndpoint instead',
        },
      },
    })

    const schema = protocol.schema()

    expect(schema.operations.createUser.description).toBe('Creates a new user account')
    expect(schema.operations.createUser.tags).toEqual(['users', 'write'])
    expect(schema.operations.legacyEndpoint.deprecated).toBe(true)
    expect(schema.operations.legacyEndpoint.deprecationMessage).toBe('Use newEndpoint instead')
  })
})

// =============================================================================
// Cycle 11: Type inference and composition patterns
// =============================================================================

describe('Protocol composition', () => {
  it('should extend a base protocol', () => {
    const baseProtocol = Protocol.define({
      name: 'base',
      version: '1.0.0',
      config: {
        apiKey: { type: 'string', required: true },
      },
      operations: {
        health: { type: 'pipe', handler: async () => ({ status: 'ok' }) },
      },
    })

    const extendedProtocol = Protocol.extend(baseProtocol, {
      name: 'extended',
      version: '1.1.0',
      config: {
        tenant: { type: 'string' },
      },
      operations: {
        getData: { type: 'pipe', handler: async () => ({ data: [] }) },
      },
    })

    const schema = extendedProtocol.schema()

    expect(schema.name).toBe('extended')
    expect(schema.config.apiKey).toBeDefined() // From base
    expect(schema.config.tenant).toBeDefined() // From extended
    expect(schema.operations.health).toBeDefined() // From base
    expect(schema.operations.getData).toBeDefined() // From extended
  })

  it('should compose multiple protocols', async () => {
    const authProtocol = Protocol.define({
      name: 'auth',
      version: '1.0.0',
      operations: {
        authenticate: { type: 'pipe', handler: async (creds: { token: string }) => ({ userId: '123' }) },
      },
    })

    const dataProtocol = Protocol.define({
      name: 'data',
      version: '1.0.0',
      operations: {
        items: { type: 'resource', schema: { name: { type: 'string' } } },
      },
    })

    const composedProtocol = Protocol.compose([authProtocol, dataProtocol], {
      name: 'app',
      version: '1.0.0',
    })

    const configured = composedProtocol.configure({})
    await configured.connect()

    // Should have operations from both protocols
    expect(configured.operations.authenticate).toBeDefined()
    expect(configured.operations.items).toBeDefined()
  })
})

// =============================================================================
// Integration tests
// =============================================================================

describe('Protocol integration', () => {
  it('should work as a complete Stripe-like protocol', async () => {
    type PaymentState = 'pending' | 'processing' | 'succeeded' | 'failed'
    type PaymentEvent = { type: 'PROCESS' } | { type: 'SUCCEED' } | { type: 'FAIL' }

    const stripeProtocol = Protocol.define({
      name: 'stripe',
      version: '1.0.0',
      config: {
        apiKey: { type: 'string', required: true },
        webhookSecret: { type: 'string' },
      },
      operations: {
        // Pipe for charges
        createCharge: {
          type: 'pipe',
          handler: async (data: { amount: number; currency: string }) => ({
            id: `ch_${Date.now()}`,
            ...data,
            status: 'succeeded',
          }),
        },
        // Resource for customers
        customers: {
          type: 'resource',
          schema: {
            email: { type: 'string' },
            name: { type: 'string' },
          },
        },
        // Channel for webhooks
        webhookEvents: {
          type: 'channel',
          channelType: 'private',
        },
        // Machine for payment flow
        paymentFlow: {
          type: 'machine',
          config: {
            id: 'stripe-payment',
            initial: 'pending' as PaymentState,
            context: { chargeId: '' },
            states: {
              pending: { on: { PROCESS: 'processing' } },
              processing: { on: { SUCCEED: 'succeeded', FAIL: 'failed' } },
              succeeded: { type: 'final' },
              failed: { type: 'final' },
            },
          },
        },
      },
    })

    const stripe = stripeProtocol.configure({
      apiKey: 'sk_test_123',
      webhookSecret: 'whsec_123',
    })

    await stripe.connect()

    // Create a customer
    const customer = await stripe.operations.customers.create({
      email: 'customer@example.com',
      name: 'Test Customer',
    })
    expect(customer.id).toBeDefined()

    // Create a charge
    const charge = await stripe.operations.createCharge({
      amount: 2000,
      currency: 'usd',
    })
    expect(charge.status).toBe('succeeded')

    // Subscribe to webhook events
    const events: any[] = []
    stripe.operations.webhookEvents.subscribe('charge.succeeded', (event) => {
      events.push(event)
    })

    // Simulate webhook
    await stripe.operations.webhookEvents.publish('charge.succeeded', { charge })
    expect(events.length).toBe(1)

    // Use payment flow machine
    const payment = stripe.operations.paymentFlow.create()
    await payment.send({ type: 'PROCESS' })
    await payment.send({ type: 'SUCCEED' })
    expect(payment.state).toBe('succeeded')

    await stripe.disconnect()
  })
})
