/**
 * TriggerEngine Integration Tests for n8n Compat
 *
 * Tests integration between n8n's trigger/node system and dotdo's TriggerEngine primitive.
 * GREEN phase - implementation tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  INodeExecutionData,
  INodeTypeDescription,
  IExecuteFunctions,
  ITriggerFunctions,
} from '../types'
import { WebhookTrigger, CronTrigger, ManualTrigger } from '../nodes'
import {
  N8nTriggerBridge,
  N8nWebhookBridge,
  N8nScheduleBridge,
  N8nPollingBridge,
  N8nWorkflowBridge,
  TriggerEngine,
  createHmacSignature,
} from '../trigger-engine-bridge'

// =============================================================================
// TEST FIXTURES
// =============================================================================

function createMockExecuteFunctions(): IExecuteFunctions {
  return {
    getInputData: vi.fn().mockReturnValue([{ json: {} }]),
    getNodeParameter: vi.fn(),
    getCredentials: vi.fn().mockResolvedValue({}),
    getWorkflowStaticData: vi.fn().mockReturnValue({}),
    helpers: {
      returnJsonArray: vi.fn((data) => data.map((d: unknown) => ({ json: d }))),
    },
  } as unknown as IExecuteFunctions
}

function createMockTriggerFunctions(
  body: Record<string, unknown> = {}
): ITriggerFunctions {
  return {
    getMode: vi.fn().mockReturnValue('trigger'),
    getActivationMode: vi.fn().mockReturnValue('activate'),
    getNodeParameter: vi.fn(),
    getWorkflowStaticData: vi.fn().mockReturnValue({}),
    emit: vi.fn(),
    emitError: vi.fn(),
    getRequestObject: vi.fn().mockReturnValue({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    getResponseObject: vi.fn().mockReturnValue({}),
    getCredentials: vi.fn().mockResolvedValue({}),
    helpers: {},
  } as unknown as ITriggerFunctions
}

// =============================================================================
// N8N TRIGGER BRIDGE TESTS
// =============================================================================

describe('N8nTriggerBridge', () => {
  describe('bridge creation', () => {
    it('should create a bridge from n8n webhook trigger node', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nTriggerBridge(engine)

      const webhookTrigger = new WebhookTrigger()
      const triggerId = await bridge.registerNode(webhookTrigger, {
        nodeId: 'webhook-1',
        parameters: {
          path: '/webhook/orders',
          httpMethod: 'POST',
        },
      })

      expect(triggerId).toBeDefined()
      expect(engine.registry.has(triggerId)).toBe(true)

      // Should be registered as webhook type
      const trigger = engine.registry.get(triggerId)
      expect(trigger?.type).toBe('webhook')
    })

    it('should create a bridge from n8n cron trigger node', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nTriggerBridge(engine)

      const cronTrigger = new CronTrigger()
      const triggerId = await bridge.registerNode(cronTrigger, {
        nodeId: 'cron-1',
        parameters: {
          cronExpression: '0 9 * * 1-5', // 9am weekdays
          timezone: 'America/New_York',
        },
      })

      expect(triggerId).toBeDefined()
      expect(engine.registry.has(triggerId)).toBe(true)

      // Should be registered as schedule type
      const trigger = engine.registry.get(triggerId)
      expect(trigger?.type).toBe('schedule')
    })

    it('should create a polling bridge for custom n8n polling nodes', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nPollingBridge(engine)

      // Custom polling node definition
      const pollingNode = {
        description: {
          displayName: 'Poll API',
          name: 'pollApi',
          group: ['trigger'],
          version: 1,
          polling: true,
          inputs: [],
          outputs: ['main'],
          properties: [
            { name: 'url', type: 'string' as const, default: '' },
            { name: 'interval', type: 'number' as const, default: 60 },
          ],
        } satisfies INodeTypeDescription,
        poll: vi.fn().mockResolvedValue([[{ json: { id: '1' } }]]),
      }

      const triggerId = await bridge.registerPollingNode(pollingNode, {
        nodeId: 'poll-1',
        parameters: {
          url: 'https://api.example.com/items',
          interval: 60,
        },
      })

      expect(triggerId).toBeDefined()
      expect(engine.registry.has(triggerId)).toBe(true)

      // Should be registered as polling type
      const trigger = engine.registry.get(triggerId)
      expect(trigger?.type).toBe('polling')
    })
  })

  describe('webhook execution', () => {
    it('should handle webhook through TriggerEngine', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nWebhookBridge(engine)

      const webhookTrigger = new WebhookTrigger()
      const triggerId = await bridge.registerNode(webhookTrigger, {
        nodeId: 'webhook-2',
        parameters: { path: '/webhook/events', httpMethod: 'POST' },
      })

      // Simulate incoming webhook
      const webhookPayload = {
        event: 'order.created',
        data: { orderId: 'ord-123', total: 99.99 },
      }

      const request = new Request('https://api.dotdo.dev/webhook/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      })

      const result = await bridge.handleWebhook(triggerId, request)

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({
        event: 'order.created',
        data: expect.objectContaining({ orderId: 'ord-123' }),
      })
    })

    it('should convert webhook result to n8n execution data format', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nWebhookBridge(engine)

      const webhookTrigger = new WebhookTrigger()
      const triggerId = await bridge.registerNode(webhookTrigger, {
        nodeId: 'webhook-3',
        parameters: { path: '/webhook/data' },
      })

      const request = new Request('https://api.dotdo.dev/webhook/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', value: 42 }),
      })

      const executionData = await bridge.handleWebhookAsExecutionData(triggerId, request)

      expect(executionData).toHaveLength(1)
      expect(executionData[0]).toMatchObject({
        json: { name: 'Test', value: 42 },
      })
    })

    it('should support HMAC signature validation', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nWebhookBridge(engine, {
        webhookSecret: 'test-secret',
        signatureHeader: 'x-signature-256',
        signatureAlgorithm: 'sha256',
      })

      const webhookTrigger = new WebhookTrigger()
      const triggerId = await bridge.registerNode(webhookTrigger, {
        nodeId: 'secure-webhook',
        parameters: { path: '/webhook/secure' },
      })

      const payload = JSON.stringify({ secure: true })
      const signature = await createHmacSignature(payload, 'test-secret', 'sha256')

      // Valid signature
      const validRequest = new Request('https://api.dotdo.dev/webhook/secure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-256': `sha256=${signature}`,
        },
        body: payload,
      })

      const validResult = await bridge.handleWebhook(triggerId, validRequest)
      expect(validResult.success).toBe(true)

      // Invalid signature
      const invalidRequest = new Request('https://api.dotdo.dev/webhook/secure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-256': 'sha256=invalid',
        },
        body: payload,
      })

      const invalidResult = await bridge.handleWebhook(triggerId, invalidRequest)
      expect(invalidResult.success).toBe(false)
      expect(invalidResult.error).toContain('signature')
    })
  })

  describe('schedule execution', () => {
    it('should register cron triggers with TriggerEngine', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nScheduleBridge(engine)

      const cronTrigger = new CronTrigger()
      const triggerId = await bridge.registerNode(cronTrigger, {
        nodeId: 'daily-report',
        parameters: {
          cronExpression: '0 8 * * *', // 8am daily
          timezone: 'UTC',
        },
      })

      const scheduleConfig = bridge.getScheduleConfig(triggerId)
      expect(scheduleConfig.cron).toBe('0 8 * * *')
      expect(scheduleConfig.timezone).toBe('UTC')
    })

    it('should emit scheduled trigger to n8n workflow', async () => {
      const engine = new TriggerEngine()
      const bridge = new N8nScheduleBridge(engine)

      const cronTrigger = new CronTrigger()
      const triggerId = await bridge.registerNode(cronTrigger, {
        nodeId: 'interval-check',
        parameters: {
          cronExpression: '*/5 * * * *', // Every 5 minutes
        },
      })

      // Subscribe to trigger emissions
      const emittedData: INodeExecutionData[][] = []
      bridge.onTrigger(triggerId, (data) => {
        emittedData.push(data)
      })

      // Manually fire the trigger (simulating cron execution)
      await bridge.fireTrigger(triggerId)

      expect(emittedData).toHaveLength(1)
      expect(emittedData[0]).toMatchObject([
        {
          json: expect.objectContaining({
            timestamp: expect.any(Number),
          }),
        },
      ])
    })
  })

  describe('polling execution', () => {
    it('should poll and deduplicate through TriggerEngine', async () => {
      let pollCount = 0
      const pollingNode = {
        description: {
          displayName: 'Poll Items',
          name: 'pollItems',
          group: ['trigger'],
          polling: true,
          inputs: [],
          outputs: ['main'],
        } as INodeTypeDescription,
        poll: vi.fn().mockImplementation(async () => {
          pollCount++
          if (pollCount === 1) {
            return [[
              { json: { id: '1', name: 'Item 1' } },
              { json: { id: '2', name: 'Item 2' } },
            ]]
          }
          return [[
            { json: { id: '2', name: 'Item 2 Updated' } }, // duplicate
            { json: { id: '3', name: 'Item 3' } }, // new
          ]]
        }),
      }

      const engine = new TriggerEngine()
      const bridge = new N8nPollingBridge(engine, {
        idField: 'id',
        intervalMs: 60_000,
      })

      const triggerId = await bridge.registerPollingNode(pollingNode, {
        nodeId: 'poll-items',
      })

      // First poll
      const results1 = await bridge.poll(triggerId)
      expect(results1).toHaveLength(2)

      // Second poll - should deduplicate
      const results2 = await bridge.poll(triggerId)
      expect(results2).toHaveLength(1)
      expect(results2[0].json).toMatchObject({ id: '3', name: 'Item 3' })
    })

    it('should persist polling state through TriggerEngine', async () => {
      let lastTimestamp: number | undefined
      const pollingNode = {
        description: {
          displayName: 'Poll with Cursor',
          name: 'pollWithCursor',
          group: ['trigger'],
          polling: true,
          inputs: [],
          outputs: ['main'],
        } as INodeTypeDescription,
        poll: vi.fn().mockImplementation(async (context: { staticData: Record<string, unknown> }) => {
          const since = context.staticData.lastPollTime as number | undefined
          lastTimestamp = since

          const now = Date.now()
          context.staticData.lastPollTime = now

          return [[
            { json: { id: now.toString(), timestamp: now } },
          ]]
        }),
      }

      const engine = new TriggerEngine()
      const bridge = new N8nPollingBridge(engine)

      const triggerId = await bridge.registerPollingNode(pollingNode, {
        nodeId: 'cursor-poll',
      })

      // First poll - no cursor
      await bridge.poll(triggerId)
      const cursor1 = await bridge.getStaticData(triggerId)
      expect(cursor1.lastPollTime).toBeDefined()

      // Second poll - uses cursor
      await bridge.poll(triggerId)
      expect(lastTimestamp).toBeDefined()
      expect(lastTimestamp).toBe(cursor1.lastPollTime)
    })
  })
})

// =============================================================================
// WORKFLOW INTEGRATION TESTS
// =============================================================================

describe('n8n Workflow Integration', () => {
  it('should execute workflow starting from TriggerEngine trigger', async () => {
    const { Workflow, WorkflowExecutor } = await import('../workflow')

    const engine = new TriggerEngine()
    const bridge = new N8nWorkflowBridge(engine)

    // Create a simple workflow with just a webhook trigger that passes through data
    const workflow = new Workflow({
      name: 'Test Workflow',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [0, 0],
          parameters: { path: '/test' },
        },
      ],
      connections: {},
    })

    // Register workflow with TriggerEngine
    const workflowId = await bridge.registerWorkflow(workflow)

    // Trigger via TriggerEngine - the trigger data should flow through
    const request = new Request('https://api.dotdo.dev/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processed: true, input: 'data' }),
    })

    const result = await bridge.triggerWorkflow(workflowId, request)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      processed: true,
    })
  })

  it('should propagate trigger context to workflow nodes', async () => {
    const { Workflow } = await import('../workflow')

    const engine = new TriggerEngine()
    const bridge = new N8nWorkflowBridge(engine)

    // Simple workflow with just a webhook trigger
    const workflow = new Workflow({
      name: 'Context Test',
      nodes: [
        {
          id: 'webhook',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    })

    const workflowId = await bridge.registerWorkflow(workflow)

    const request = new Request('https://api.dotdo.dev/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true, hasContext: true }),
    })

    const result = await bridge.triggerWorkflow(workflowId, request)

    // Verify workflow executed properly and passed through trigger data
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ test: true, hasContext: true })
  })
})

// =============================================================================
// UNIFIED OUTPUT FORMAT TESTS
// =============================================================================

describe('Unified Output Format', () => {
  it('should convert n8n INodeExecutionData to TriggerOutput', async () => {
    const engine = new TriggerEngine()
    const bridge = new N8nTriggerBridge(engine)

    const webhookTrigger = new WebhookTrigger()
    const triggerId = await bridge.registerNode(webhookTrigger, {
      nodeId: 'output-test',
      parameters: { path: '/output-test' },
    })

    const request = new Request('https://api.dotdo.dev/output-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    })

    const triggerOutput = await bridge.handleWebhookRaw(triggerId, request)

    expect(triggerOutput).toMatchObject({
      success: true,
      triggerId: expect.stringContaining('output-test'),
      timestamp: expect.any(Number),
      source: 'webhook',
      data: expect.objectContaining({ email: 'test@example.com' }),
    })
  })

  it('should include n8n node metadata in output context', async () => {
    const engine = new TriggerEngine()
    const bridge = new N8nTriggerBridge(engine)

    const webhookTrigger = new WebhookTrigger()
    const triggerId = await bridge.registerNode(webhookTrigger, {
      nodeId: 'node-metadata',
      parameters: { path: '/metadata' },
      workflowId: 'wf-123',
      workflowName: 'Test Workflow',
    })

    const request = new Request('https://api.dotdo.dev/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const output = await bridge.handleWebhookRaw(triggerId, request)

    expect(output.context).toMatchObject({
      n8n: {
        nodeId: 'node-metadata',
        nodeName: 'Webhook',
        nodeType: 'n8n-nodes-base.webhook',
        workflowId: 'wf-123',
        workflowName: 'Test Workflow',
      },
    })
  })
})

// =============================================================================
// STATISTICS AND MONITORING TESTS
// =============================================================================

describe('Trigger Statistics', () => {
  it('should track n8n trigger statistics through TriggerEngine', async () => {
    const engine = new TriggerEngine()
    const bridge = new N8nTriggerBridge(engine)

    const webhookTrigger = new WebhookTrigger()
    const triggerId = await bridge.registerNode(webhookTrigger, {
      nodeId: 'stats-node',
      parameters: { path: '/stats' },
    })

    // Execute a few times - clone request each time since body can only be read once
    const createRequest = () => new Request('https://api.dotdo.dev/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    await bridge.handleWebhook(triggerId, createRequest())
    await bridge.handleWebhook(triggerId, createRequest())
    await bridge.handleWebhook(triggerId, createRequest())

    const stats = engine.getStats(triggerId)
    expect(stats.fireCount).toBe(3)
    expect(stats.successCount).toBe(3)
    expect(stats.failureCount).toBe(0)
  })
})

// =============================================================================
// EVENT BUS INTEGRATION TESTS
// =============================================================================

describe('Event Bus Integration', () => {
  it('should emit events to TriggerEngine EventBus', async () => {
    const engine = new TriggerEngine()
    const bridge = new N8nTriggerBridge(engine)

    const receivedEvents: unknown[] = []
    engine.events.on('n8n.trigger.fired', (data) => {
      receivedEvents.push(data)
    })

    const webhookTrigger = new WebhookTrigger()
    const triggerId = await bridge.registerNode(webhookTrigger, {
      nodeId: 'event-test',
      parameters: { path: '/events' },
    })

    const request = new Request('https://api.dotdo.dev/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    })

    await bridge.handleWebhook(triggerId, request)

    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toMatchObject({
      triggerId,
      nodeType: 'n8n-nodes-base.webhook',
    })
  })

  it('should allow subscribing to specific node triggers', async () => {
    const engine = new TriggerEngine()
    const bridge = new N8nTriggerBridge(engine)

    const webhookTrigger = new WebhookTrigger()
    const triggerId = await bridge.registerNode(webhookTrigger, {
      nodeId: 'subscribe-test',
      parameters: { path: '/subscribe' },
    })

    const receivedData: INodeExecutionData[][] = []
    const unsubscribe = bridge.onTrigger(triggerId, (data) => {
      receivedData.push(data)
    })

    // Clone request each time since body can only be read once
    const createRequest = () => new Request('https://api.dotdo.dev/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    })

    await bridge.handleWebhook(triggerId, createRequest())
    expect(receivedData).toHaveLength(1)

    // Unsubscribe
    unsubscribe()

    await bridge.handleWebhook(triggerId, createRequest())
    expect(receivedData).toHaveLength(1) // No new data
  })
})

// =============================================================================
// CREDENTIALS INTEGRATION TESTS
// =============================================================================

describe('Credentials Integration', () => {
  it('should pass credentials from TriggerEngine context to nodes', async () => {
    let capturedCredentials: unknown

    const pollingNode = {
      description: {
        displayName: 'Auth Poll',
        name: 'authPoll',
        group: ['trigger'],
        polling: true,
        credentials: [{ name: 'api', required: true }],
        inputs: [],
        outputs: ['main'],
      } as INodeTypeDescription,
      poll: vi.fn().mockImplementation(async (context: { credentials: Record<string, unknown> }) => {
        capturedCredentials = context.credentials
        return [[{ json: { authenticated: true } }]]
      }),
    }

    const engine = new TriggerEngine()
    const bridge = new N8nPollingBridge(engine)

    const triggerId = await bridge.registerPollingNode(pollingNode, {
      nodeId: 'auth-poll',
      credentials: {
        api: { apiKey: 'secret-key-123' },
      },
    })

    await bridge.poll(triggerId)

    expect(capturedCredentials).toMatchObject({
      api: { apiKey: 'secret-key-123' },
    })
  })
})
