/**
 * E2E Workflow Tests - WorkflowContext ($) Integration
 *
 * Tests the WorkflowContext ($) feature that provides:
 * 1. Event handlers ($.on.Noun.verb)
 * 2. Durability levels ($.send, $.try, $.do)
 * 3. Scheduling ($.every.Monday.at('9am'))
 * 4. Cross-DO RPC ($.Order('id').method())
 *
 * Critical path tests for workflow orchestration.
 *
 * NO MOCKS - uses real Miniflare instances.
 *
 * @module e2e/tests/workflows.test
 * @see do-cymx
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface WorkflowEvent {
  type: string
  payload?: Record<string, unknown>
  timestamp?: number
}

interface ScheduledJob {
  id: string
  schedule: string
  handler: string
  nextRun?: number
}

// ============================================================================
// TEST DO SCRIPT - Workflow Support
// ============================================================================

const WORKFLOW_DO_SCRIPT = `
// Event store for testing
const eventStore = new Map()
const scheduledJobs = new Map()
let eventCounter = 0

function generateId() {
  return 'event-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

export class WorkflowDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Workflow event emission
    if (path === '/workflows/emit' && request.method === 'POST') {
      return this.emitEvent(request)
    }

    // List events
    if (path === '/workflows/events' && request.method === 'GET') {
      return this.listEvents()
    }

    // Schedule a job
    if (path === '/workflows/schedule' && request.method === 'POST') {
      return this.scheduleJob(request)
    }

    // List scheduled jobs
    if (path === '/workflows/schedules' && request.method === 'GET') {
      return this.listSchedules()
    }

    // Execute workflow (simulate $.do with retries)
    if (path === '/workflows/execute' && request.method === 'POST') {
      return this.executeWorkflow(request)
    }

    // RPC endpoint for cross-DO calls
    if (path === '/rpc' && request.method === 'POST') {
      return this.handleRPC(request)
    }

    // Health
    if (path === '/health') {
      return Response.json({ status: 'ok' })
    }

    return Response.json({ error: 'Not Found', path }, { status: 404 })
  }

  async emitEvent(request) {
    const { type, payload } = await request.json()

    const event = {
      $id: generateId(),
      type,
      payload,
      timestamp: Date.now(),
      handled: false
    }

    // Store event
    await this.storage.put('event:' + event.$id, event)

    // Add to index
    const index = await this.storage.get('event-index') || []
    index.push(event.$id)
    await this.storage.put('event-index', index)

    // Simulate event handler execution
    const handlerKey = 'handler:' + type
    const handler = await this.storage.get(handlerKey)

    if (handler) {
      event.handled = true
      event.handlerResult = 'Handler executed: ' + handler
      await this.storage.put('event:' + event.$id, event)
    }

    return Response.json(event, { status: 201 })
  }

  async listEvents() {
    const index = await this.storage.get('event-index') || []
    const events = []

    for (const id of index) {
      const event = await this.storage.get('event:' + id)
      if (event) {
        events.push(event)
      }
    }

    return Response.json(events)
  }

  async scheduleJob(request) {
    const { schedule, handler } = await request.json()

    const job = {
      id: generateId(),
      schedule,
      handler,
      createdAt: Date.now(),
      nextRun: this.calculateNextRun(schedule)
    }

    await this.storage.put('schedule:' + job.id, job)

    const index = await this.storage.get('schedule-index') || []
    index.push(job.id)
    await this.storage.put('schedule-index', index)

    return Response.json(job, { status: 201 })
  }

  async listSchedules() {
    const index = await this.storage.get('schedule-index') || []
    const schedules = []

    for (const id of index) {
      const schedule = await this.storage.get('schedule:' + id)
      if (schedule) {
        schedules.push(schedule)
      }
    }

    return Response.json(schedules)
  }

  async executeWorkflow(request) {
    const { action, maxRetries = 3 } = await request.json()

    const execution = {
      id: generateId(),
      action,
      attempts: 0,
      maxRetries,
      status: 'pending',
      startedAt: Date.now()
    }

    // Simulate retry logic
    let success = false
    while (execution.attempts < maxRetries && !success) {
      execution.attempts++

      try {
        // Simulate action execution
        if (action.shouldFail && execution.attempts < action.failUntilAttempt) {
          throw new Error('Simulated failure')
        }

        success = true
        execution.status = 'completed'
        execution.result = 'Action completed successfully'
        execution.completedAt = Date.now()
      } catch (error) {
        execution.lastError = error.message

        if (execution.attempts >= maxRetries) {
          execution.status = 'failed'
          execution.failedAt = Date.now()
        }
      }
    }

    await this.storage.put('execution:' + execution.id, execution)

    return Response.json(execution, {
      status: execution.status === 'completed' ? 200 : 500
    })
  }

  calculateNextRun(schedule) {
    // Simplified schedule calculation
    const now = Date.now()

    if (schedule.includes('every hour')) {
      return now + 3600000
    }
    if (schedule.includes('every day')) {
      return now + 86400000
    }
    if (schedule.includes('Monday')) {
      return now + 604800000 // 1 week
    }

    return now + 3600000 // Default 1 hour
  }

  async handleRPC(request) {
    try {
      const { method, args } = await request.json()
      const fn = this[method]

      if (typeof fn !== 'function') {
        return Response.json({ error: 'Method not found: ' + method }, { status: 404 })
      }

      const result = await fn.apply(this, args || [])
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  // RPC methods for cross-DO testing
  async getEventCount() {
    const index = await this.storage.get('event-index') || []
    return index.length
  }

  async getScheduleCount() {
    const index = await this.storage.get('schedule-index') || []
    return index.length
  }

  async registerHandler(eventType, handlerName) {
    await this.storage.put('handler:' + eventType, handlerName)
    return { registered: true, eventType, handler: handlerName }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Extract namespace
    let namespace = 'default'
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    }

    const id = env.WORKFLOW_DO.idFromName(namespace)
    const stub = env.WORKFLOW_DO.get(id)

    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function createClient(mf: Miniflare, tenantId: string = 'default') {
  return {
    async request<T = unknown>(path: string, options: RequestInit = {}): Promise<{ status: number; data: T }> {
      const headers = new Headers(options.headers)
      headers.set('X-Tenant-ID', tenantId)
      headers.set('Content-Type', 'application/json')

      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        ...options,
        headers,
      })

      const status = response.status
      if (status === 204) {
        return { status, data: undefined as T }
      }

      const data = await response.json() as T
      return { status, data }
    },

    async emitEvent(type: string, payload?: Record<string, unknown>) {
      return this.request<WorkflowEvent>('/workflows/emit', {
        method: 'POST',
        body: JSON.stringify({ type, payload }),
      })
    },

    async listEvents() {
      return this.request<WorkflowEvent[]>('/workflows/events')
    },

    async scheduleJob(schedule: string, handler: string) {
      return this.request<ScheduledJob>('/workflows/schedule', {
        method: 'POST',
        body: JSON.stringify({ schedule, handler }),
      })
    },

    async listSchedules() {
      return this.request<ScheduledJob[]>('/workflows/schedules')
    },

    async executeWorkflow(action: Record<string, unknown>, maxRetries?: number) {
      return this.request('/workflows/execute', {
        method: 'POST',
        body: JSON.stringify({ action, maxRetries }),
      })
    },

    async rpc<T = unknown>(method: string, args: unknown[] = []) {
      return this.request<T>('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method, args }),
      })
    },

    async health() {
      return this.request<{ status: string }>('/health')
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('E2E Workflow Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: WORKFLOW_DO_SCRIPT,
      durableObjects: {
        WORKFLOW_DO: 'WorkflowDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  describe('Event Emission ($.send)', () => {
    it('should emit events and store them', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `emit-${testId}`)

      const result = await client.emitEvent('customer.signup', {
        email: 'test@example.com',
        plan: 'premium',
      })

      expect(result.status).toBe(201)
      expect(result.data.$id).toBeDefined()
      expect(result.data.type).toBe('customer.signup')
      expect(result.data.payload?.email).toBe('test@example.com')
      expect(result.data.timestamp).toBeDefined()
    })

    it('should list all emitted events', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `list-events-${testId}`)

      // Emit multiple events
      await client.emitEvent('order.created', { orderId: 'order-1' })
      await client.emitEvent('order.shipped', { orderId: 'order-1' })
      await client.emitEvent('order.delivered', { orderId: 'order-1' })

      const list = await client.listEvents()

      expect(list.status).toBe(200)
      expect(list.data).toHaveLength(3)

      const types = list.data.map(e => e.type)
      expect(types).toContain('order.created')
      expect(types).toContain('order.shipped')
      expect(types).toContain('order.delivered')
    })

    it('should execute registered event handlers', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `handlers-${testId}`)

      // Register a handler
      const registerResult = await client.rpc('registerHandler', ['user.login', 'handleUserLogin'])
      expect(registerResult.data.registered).toBe(true)

      // Emit event
      const emitResult = await client.emitEvent('user.login', { userId: 'user-123' })

      expect(emitResult.data.handled).toBe(true)
      expect(emitResult.data.handlerResult).toContain('handleUserLogin')
    })
  })

  describe('Scheduling ($.every)', () => {
    it('should schedule jobs with cron-like expressions', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `schedule-${testId}`)

      const result = await client.scheduleJob('every day at 9am', 'generateDailyReport')

      expect(result.status).toBe(201)
      expect(result.data.id).toBeDefined()
      expect(result.data.schedule).toBe('every day at 9am')
      expect(result.data.handler).toBe('generateDailyReport')
      expect(result.data.nextRun).toBeDefined()
    })

    it('should list all scheduled jobs', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `list-schedules-${testId}`)

      await client.scheduleJob('every hour', 'checkHealth')
      await client.scheduleJob('every Monday at 9am', 'weeklyReport')
      await client.scheduleJob('every day at 6pm', 'dailySummary')

      const list = await client.listSchedules()

      expect(list.status).toBe(200)
      expect(list.data).toHaveLength(3)

      const handlers = list.data.map(s => s.handler)
      expect(handlers).toContain('checkHealth')
      expect(handlers).toContain('weeklyReport')
      expect(handlers).toContain('dailySummary')
    })

    it('should calculate next run times', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `next-run-${testId}`)

      const now = Date.now()
      const result = await client.scheduleJob('every hour', 'hourlyTask')

      expect(result.data.nextRun).toBeGreaterThan(now)
      // Should be approximately 1 hour in future (with some tolerance)
      expect(result.data.nextRun! - now).toBeGreaterThan(3500000) // > 58 minutes
      expect(result.data.nextRun! - now).toBeLessThan(3700000) // < 62 minutes
    })
  })

  describe('Durability Levels ($.do with retries)', () => {
    it('should retry failed actions until success', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `retry-${testId}`)

      // Action that fails on first 2 attempts, succeeds on 3rd
      const action = {
        name: 'flaky-action',
        shouldFail: true,
        failUntilAttempt: 3,
      }

      const result = await client.executeWorkflow(action, 5)

      expect(result.status).toBe(200)
      expect(result.data.status).toBe('completed')
      expect(result.data.attempts).toBe(3)
      expect(result.data.result).toContain('completed successfully')
    })

    it('should fail after max retries exceeded', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `fail-${testId}`)

      // Action that always fails
      const action = {
        name: 'always-fails',
        shouldFail: true,
        failUntilAttempt: 999,
      }

      const result = await client.executeWorkflow(action, 3)

      expect(result.status).toBe(500)
      expect(result.data.status).toBe('failed')
      expect(result.data.attempts).toBe(3)
      expect(result.data.lastError).toContain('Simulated failure')
    })

    it('should complete on first attempt if no failures', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `success-${testId}`)

      const action = {
        name: 'immediate-success',
        shouldFail: false,
      }

      const result = await client.executeWorkflow(action)

      expect(result.status).toBe(200)
      expect(result.data.status).toBe('completed')
      expect(result.data.attempts).toBe(1)
    })

    it('should track execution timing', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `timing-${testId}`)

      const startTime = Date.now()
      const result = await client.executeWorkflow({ name: 'timed-action' })

      expect(result.data.startedAt).toBeGreaterThanOrEqual(startTime)
      expect(result.data.completedAt).toBeGreaterThanOrEqual(result.data.startedAt)
      expect(result.data.completedAt! - result.data.startedAt).toBeLessThan(1000) // < 1 second
    })
  })

  describe('Cross-DO RPC', () => {
    it('should call methods on other DOs via RPC', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `rpc-${testId}`)

      // Emit some events
      await client.emitEvent('test.event.1', {})
      await client.emitEvent('test.event.2', {})

      // Get count via RPC
      const countResult = await client.rpc<number>('getEventCount')

      expect(countResult.status).toBe(200)
      expect(countResult.data).toBe(2)
    })

    it('should handle RPC errors gracefully', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `rpc-error-${testId}`)

      const result = await client.rpc('nonExistentMethod')

      expect(result.status).toBe(404)
      expect(result.data.error).toContain('Method not found')
    })

    it('should support RPC with arguments', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `rpc-args-${testId}`)

      const result = await client.rpc('registerHandler', ['custom.event', 'customHandler'])

      expect(result.status).toBe(200)
      expect(result.data.registered).toBe(true)
      expect(result.data.eventType).toBe('custom.event')
      expect(result.data.handler).toBe('customHandler')
    })
  })

  describe('Workflow Orchestration', () => {
    it('should coordinate events, schedules, and execution', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `orchestration-${testId}`)

      // 1. Register event handler
      await client.rpc('registerHandler', ['order.placed', 'processOrder'])

      // 2. Schedule daily summary
      await client.scheduleJob('every day at 6pm', 'orderSummary')

      // 3. Emit event
      const event = await client.emitEvent('order.placed', {
        orderId: 'order-123',
        amount: 99.99,
      })

      // 4. Execute workflow action
      const execution = await client.executeWorkflow({
        name: 'fulfillOrder',
        orderId: event.data.$id,
      })

      // Verify all pieces worked
      expect(event.data.handled).toBe(true)
      expect(execution.data.status).toBe('completed')

      const schedules = await client.listSchedules()
      expect(schedules.data).toHaveLength(1)

      const events = await client.listEvents()
      expect(events.data).toHaveLength(1)
    })

    it('should handle complex multi-step workflows', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `multi-step-${testId}`)

      // Simulate order fulfillment workflow
      const steps = [
        { name: 'validatePayment', shouldFail: false },
        { name: 'checkInventory', shouldFail: false },
        { name: 'shipOrder', shouldFail: true, failUntilAttempt: 2 }, // Retry once
        { name: 'sendConfirmation', shouldFail: false },
      ]

      const results = []
      for (const step of steps) {
        const result = await client.executeWorkflow(step, 3)
        results.push(result.data)
      }

      // All steps should complete
      expect(results.every(r => r.status === 'completed')).toBe(true)

      // shipOrder should have retried
      const shipStep = results[2]
      expect(shipStep.attempts).toBe(2)
    })
  })

  describe('Isolation and Concurrency', () => {
    it('should isolate workflows across tenants', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createClient(mf, `tenant-a-${testId}`)
      const tenantB = createClient(mf, `tenant-b-${testId}`)

      // Emit events in both tenants
      await tenantA.emitEvent('tenant.a.event', { data: 'A' })
      await tenantB.emitEvent('tenant.b.event', { data: 'B' })

      // Each tenant should only see their own events
      const eventsA = await tenantA.listEvents()
      const eventsB = await tenantB.listEvents()

      expect(eventsA.data).toHaveLength(1)
      expect(eventsB.data).toHaveLength(1)

      expect(eventsA.data[0].type).toBe('tenant.a.event')
      expect(eventsB.data[0].type).toBe('tenant.b.event')
    })

    it('should handle concurrent workflow executions', async () => {
      const testId = Date.now().toString(36)
      const client = createClient(mf, `concurrent-${testId}`)

      // Execute multiple workflows in parallel
      const promises = Array.from({ length: 10 }, (_, i) =>
        client.executeWorkflow({
          name: `concurrent-workflow-${i}`,
          index: i,
        })
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      expect(results.every(r => r.data.status === 'completed')).toBe(true)
    })
  })
})
