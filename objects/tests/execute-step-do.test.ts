/**
 * Execute Step DO Tests
 *
 * RED TDD: Tests for wiring step execution to call Durable Objects via $ proxy pattern.
 *
 * Features tested:
 * - $.Users(id).method() style DO calls from steps
 * - DO method result handling
 * - DO error handling
 * - Multiple DO calls per step
 * - StepDOBridge integration with WorkflowRuntime
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { WorkflowRuntime, type WorkflowRuntimeConfig, type StepContext } from '../WorkflowRuntime'
import { StepDOBridge, type DOStub, type DONamespaceBinding } from '../StepDOBridge'

// ============================================================================
// MOCK DO STATE
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()
  const alarms: { time: number | null } = { time: null }

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      getAlarm: vi.fn(async () => alarms.time),
      setAlarm: vi.fn(async (time: number | Date) => {
        alarms.time = typeof time === 'number' ? time : time.getTime()
      }),
      deleteAlarm: vi.fn(async () => {
        alarms.time = null
      }),
    },
    alarms,
    _storage: storage,
  }
}

function createMockState() {
  const { storage, alarms, _storage } = createMockStorage()
  return {
    id: { toString: () => 'test-workflow-runtime-do-id' },
    storage,
    alarms,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { alarms: { time: number | null }; _storage: Map<string, unknown> }
}

// ============================================================================
// MOCK DO STUB & NAMESPACE
// ============================================================================

function createMockDOStub(methods: Record<string, (...args: unknown[]) => unknown>): DOStub {
  return {
    fetch: vi.fn(async (request: Request) => {
      const url = new URL(request.url)
      const methodName = url.pathname.slice(1) // Remove leading /

      // Parse body safely - may be empty
      let body: unknown = undefined
      if (request.method === 'POST') {
        const text = await request.text()
        if (text) {
          try {
            body = JSON.parse(text)
          } catch {
            body = undefined
          }
        }
      }

      if (methods[methodName]) {
        try {
          const result = await methods[methodName](body)
          return new Response(JSON.stringify({ result }), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          return new Response(
            JSON.stringify({
              error: {
                message: error instanceof Error ? error.message : String(error),
                name: error instanceof Error ? error.name : 'Error',
              },
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }

      return new Response(JSON.stringify({ error: { message: `Method not found: ${methodName}`, name: 'MethodNotFoundError' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

function createMockDONamespace(stubs: Record<string, DOStub>): DONamespaceBinding {
  return {
    idFromName: vi.fn((name: string) => ({ toString: () => `id:${name}` }) as DurableObjectId),
    idFromString: vi.fn((str: string) => ({ toString: () => str }) as DurableObjectId),
    get: vi.fn((id: DurableObjectId) => {
      const idStr = id.toString()
      const name = idStr.startsWith('id:') ? idStr.slice(3) : idStr
      return stubs[name] || createMockDOStub({})
    }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('StepDOBridge', () => {
  // ==========================================================================
  // 1. BASIC CONSTRUCTION
  // ==========================================================================

  describe('Construction', () => {
    it('creates a bridge with DO namespace bindings', () => {
      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({}),
        Orders: createMockDONamespace({}),
      }

      const bridge = new StepDOBridge(namespaces)

      expect(bridge).toBeDefined()
    })

    it('creates a domain proxy via createProxy()', () => {
      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({}),
      }

      const bridge = new StepDOBridge(namespaces)
      const proxy = bridge.createProxy()

      expect(proxy).toBeDefined()
    })
  })

  // ==========================================================================
  // 2. BASIC DO CALLS
  // ==========================================================================

  describe('Basic DO Calls', () => {
    it('calls $.Users(id).method() and returns result', async () => {
      const usersStub = createMockDOStub({
        create: async (data: { name: string }) => ({
          id: 'user-123',
          name: data.name,
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      const result = await $.Users('user-123').create({ name: 'John' })

      expect(result).toEqual({
        id: 'user-123',
        name: 'John',
      })
    })

    it('calls $.Orders(id).get() and returns order data', async () => {
      const ordersStub = createMockDOStub({
        get: async () => ({
          id: 'order-456',
          total: 99.99,
          status: 'pending',
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Orders: createMockDONamespace({ 'order-456': ordersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      const result = await $.Orders('order-456').get()

      expect(result).toEqual({
        id: 'order-456',
        total: 99.99,
        status: 'pending',
      })
    })

    it('passes arguments to DO method calls', async () => {
      const capturedArgs: unknown[] = []

      const usersStub = createMockDOStub({
        update: async (data: unknown) => {
          capturedArgs.push(data)
          return { updated: true }
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      await $.Users('user-123').update({ name: 'Jane', email: 'jane@example.com' })

      expect(capturedArgs).toEqual([{ name: 'Jane', email: 'jane@example.com' }])
    })
  })

  // ==========================================================================
  // 3. ERROR HANDLING
  // ==========================================================================

  describe('Error Handling', () => {
    it('throws error when DO method fails', async () => {
      const usersStub = createMockDOStub({
        create: async () => {
          throw new Error('User already exists')
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      await expect($.Users('user-123').create({ name: 'John' })).rejects.toThrow('User already exists')
    })

    it('throws error when DO namespace is not registered', async () => {
      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({}),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      await expect($.Products('prod-123').get()).rejects.toThrow(/Products.*not registered|namespace.*not found/i)
    })

    it('throws error when method does not exist on DO', async () => {
      const usersStub = createMockDOStub({
        create: async () => ({ id: 'user-123' }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      await expect($.Users('user-123').nonexistentMethod()).rejects.toThrow(/not found|does not exist/i)
    })

    it('preserves original error type from DO', async () => {
      class ValidationError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'ValidationError'
        }
      }

      const usersStub = createMockDOStub({
        create: async () => {
          throw new ValidationError('Invalid email format')
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      try {
        await $.Users('user-123').create({ email: 'invalid' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toBe('Invalid email format')
        // The error name should be preserved or wrapped
        expect((error as Error).name).toMatch(/ValidationError|DOError/i)
      }
    })
  })

  // ==========================================================================
  // 4. MULTIPLE DO CALLS
  // ==========================================================================

  describe('Multiple DO Calls', () => {
    it('supports calling multiple DOs in sequence', async () => {
      const usersStub = createMockDOStub({
        create: async (data: { name: string }) => ({
          id: 'user-123',
          name: data.name,
        }),
      })

      const notificationsStub = createMockDOStub({
        send: async (data: { message: string }) => ({
          sent: true,
          message: data.message,
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
        Notifications: createMockDONamespace({ 'user-123': notificationsStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      const user = await $.Users('user-123').create({ name: 'John' })
      const notification = await $.Notifications('user-123').send({ message: 'Welcome!' })

      expect(user).toEqual({ id: 'user-123', name: 'John' })
      expect(notification).toEqual({ sent: true, message: 'Welcome!' })
    })

    it('supports calling same DO multiple times', async () => {
      let callCount = 0

      const usersStub = createMockDOStub({
        increment: async () => {
          callCount++
          return { count: callCount }
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      const result1 = await $.Users('user-123').increment()
      const result2 = await $.Users('user-123').increment()
      const result3 = await $.Users('user-123').increment()

      expect(result1).toEqual({ count: 1 })
      expect(result2).toEqual({ count: 2 })
      expect(result3).toEqual({ count: 3 })
    })

    it('supports calling different instances of same DO type', async () => {
      const user1Stub = createMockDOStub({
        getName: async () => ({ name: 'Alice' }),
      })

      const user2Stub = createMockDOStub({
        getName: async () => ({ name: 'Bob' }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({
          'user-1': user1Stub,
          'user-2': user2Stub,
        }),
      }

      const bridge = new StepDOBridge(namespaces)
      const $ = bridge.createProxy()

      const alice = await $.Users('user-1').getName()
      const bob = await $.Users('user-2').getName()

      expect(alice).toEqual({ name: 'Alice' })
      expect(bob).toEqual({ name: 'Bob' })
    })
  })
})

// ============================================================================
// WORKFLOW RUNTIME INTEGRATION TESTS
// ============================================================================

describe('WorkflowRuntime + StepDOBridge Integration', () => {
  let mockState: ReturnType<typeof createMockState>
  let runtime: WorkflowRuntime

  beforeEach(() => {
    mockState = createMockState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // 1. STEP CONTEXT $ PROXY
  // ==========================================================================

  describe('Step Context $ Proxy', () => {
    it('provides $ proxy in step context with DO bindings', async () => {
      const usersStub = createMockDOStub({
        create: async (data: { name: string }) => ({
          id: 'user-123',
          name: data.name,
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      let capturedResult: unknown = null

      runtime.registerStep('createUser', async (ctx) => {
        capturedResult = await ctx.$.Users('user-123').create({ name: 'John' })
        return capturedResult
      })

      await runtime.start({})

      expect(capturedResult).toEqual({
        id: 'user-123',
        name: 'John',
      })
    })

    it('allows step to call multiple DOs via $ proxy', async () => {
      const usersStub = createMockDOStub({
        create: async (data: { name: string }) => ({
          id: 'user-123',
          name: data.name,
        }),
      })

      const notificationsStub = createMockDOStub({
        send: async (data: { message: string }) => ({
          sent: true,
          recipientId: 'user-123',
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
        Notifications: createMockDONamespace({ 'user-123': notificationsStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      let userResult: unknown = null
      let notificationResult: unknown = null

      runtime.registerStep('createUser', async (ctx) => {
        userResult = await ctx.$.Users('user-123').create({ name: 'John' })
        notificationResult = await ctx.$.Notifications('user-123').send({ message: 'Welcome!' })
        return { user: userResult, notification: notificationResult }
      })

      await runtime.start({})

      expect(userResult).toEqual({ id: 'user-123', name: 'John' })
      expect(notificationResult).toEqual({ sent: true, recipientId: 'user-123' })
    })
  })

  // ==========================================================================
  // 2. STEP DO ERROR HANDLING
  // ==========================================================================

  describe('Step DO Error Handling', () => {
    it('fails step when DO call fails', async () => {
      const usersStub = createMockDOStub({
        create: async () => {
          throw new Error('Database connection failed')
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      runtime.registerStep('createUser', async (ctx) => {
        return await ctx.$.Users('user-123').create({ name: 'John' })
      })

      await expect(runtime.start({})).rejects.toThrow()
      expect(runtime.state).toBe('failed')
    })

    it('retries step when DO call fails with retry config', async () => {
      let attempts = 0

      const usersStub = createMockDOStub({
        create: async () => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return { id: 'user-123', name: 'John' }
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      runtime.registerStep(
        'createUser',
        async (ctx) => {
          return await ctx.$.Users('user-123').create({ name: 'John' })
        },
        { retries: 3 },
      )

      const result = await runtime.start({})

      expect(attempts).toBe(3)
      expect(result.output).toEqual({ id: 'user-123', name: 'John' })
    })
  })

  // ==========================================================================
  // 3. MULTI-STEP DO CALLS
  // ==========================================================================

  describe('Multi-Step DO Calls', () => {
    it('passes DO results between steps', async () => {
      const usersStub = createMockDOStub({
        create: async (data: { name: string }) => ({
          id: 'user-123',
          name: data.name,
        }),
      })

      const ordersStub = createMockDOStub({
        create: async (data: { userId: string; items: string[] }) => ({
          id: 'order-456',
          userId: data.userId,
          items: data.items,
        }),
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
        Orders: createMockDONamespace({ 'order-456': ordersStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      runtime.registerStep('createUser', async (ctx) => {
        const user = await ctx.$.Users('user-123').create({ name: 'John' })
        return { userId: user.id }
      })

      runtime.registerStep('createOrder', async (ctx) => {
        const prevOutput = ctx.previousStepOutput as { userId: string }
        const order = await ctx.$.Orders('order-456').create({
          userId: prevOutput.userId,
          items: ['item-1', 'item-2'],
        })
        return order
      })

      const result = await runtime.start({})

      expect(result.output).toEqual({
        id: 'order-456',
        userId: 'user-123',
        items: ['item-1', 'item-2'],
      })
    })
  })

  // ==========================================================================
  // 4. WORKFLOW INPUT WITH DO CALLS
  // ==========================================================================

  describe('Workflow Input with DO Calls', () => {
    it('uses workflow input in DO calls', async () => {
      let capturedInput: unknown = null

      const usersStub = createMockDOStub({
        create: async (data: unknown) => {
          capturedInput = data
          return { id: 'user-123', ...data }
        },
      })

      const namespaces: Record<string, DONamespaceBinding> = {
        Users: createMockDONamespace({ 'user-123': usersStub }),
      }

      const bridge = new StepDOBridge(namespaces)

      runtime = new WorkflowRuntime(mockState, { name: 'test-workflow' }, { domainProxy: bridge.createProxy() })

      runtime.registerStep('createUser', async (ctx) => {
        const input = ctx.input as { name: string; email: string }
        return await ctx.$.Users('user-123').create({
          name: input.name,
          email: input.email,
        })
      })

      await runtime.start({ name: 'Jane', email: 'jane@example.com' })

      expect(capturedInput).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
      })
    })
  })
})

// ============================================================================
// COMPLEX WORKFLOW SCENARIOS
// ============================================================================

describe('Complex Workflow Scenarios', () => {
  let mockState: ReturnType<typeof createMockState>

  beforeEach(() => {
    mockState = createMockState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('implements full user onboarding workflow with multiple DO calls', async () => {
    const usersStub = createMockDOStub({
      create: async (data: { name: string; email: string }) => ({
        id: 'user-123',
        name: data.name,
        email: data.email,
      }),
    })

    const profilesStub = createMockDOStub({
      create: async (data: { userId: string; avatar: string }) => ({
        id: 'profile-789',
        userId: data.userId,
        avatar: data.avatar,
      }),
    })

    const notificationsStub = createMockDOStub({
      send: async (data: { userId: string; template: string }) => ({
        sent: true,
        userId: data.userId,
        template: data.template,
      }),
    })

    const namespaces: Record<string, DONamespaceBinding> = {
      Users: createMockDONamespace({ 'user-123': usersStub }),
      Profiles: createMockDONamespace({ 'profile-789': profilesStub }),
      Notifications: createMockDONamespace({ 'user-123': notificationsStub }),
    }

    const bridge = new StepDOBridge(namespaces)

    const runtime = new WorkflowRuntime(mockState, { name: 'user-onboarding' }, { domainProxy: bridge.createProxy() })

    runtime
      .step('createUser', async (ctx) => {
        const input = ctx.input as { name: string; email: string }
        const user = await ctx.$.Users('user-123').create({
          name: input.name,
          email: input.email,
        })
        return { userId: user.id }
      })
      .step('createProfile', async (ctx) => {
        const prev = ctx.previousStepOutput as { userId: string }
        const profile = await ctx.$.Profiles('profile-789').create({
          userId: prev.userId,
          avatar: 'default.png',
        })
        return { ...prev, profileId: profile.id }
      })
      .step('sendWelcome', async (ctx) => {
        const prev = ctx.previousStepOutput as { userId: string; profileId: string }
        await ctx.$.Notifications('user-123').send({
          userId: prev.userId,
          template: 'welcome',
        })
        return prev
      })

    const result = await runtime.start({ name: 'Alice', email: 'alice@example.com' })

    expect(result.status).toBe('completed')
    expect(result.output).toEqual({
      userId: 'user-123',
      profileId: 'profile-789',
    })
  })
})
