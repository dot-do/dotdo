/**
 * Examples E2E Tests
 *
 * Tests that all examples at example.org.ai are functional.
 * Each example is a namespace of the main DO, accessible via subdomain.
 *
 * Structure:
 *   examples/crm.example.org.ai/     → https://crm.example.org.ai
 *   examples/redis.example.org.ai/   → https://redis.example.org.ai
 *   etc.
 *
 * Configuration:
 *   EXAMPLES_DOMAIN - Base domain for examples (default: example.org.ai)
 *   TEST_TOKEN - Auth token for protected endpoints
 *
 * @example
 * ```bash
 * # Test all deployed examples
 * npm run test:e2e
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRPCClient } from '../../rpc/index'
import * as fs from 'fs'
import * as path from 'path'

// =============================================================================
// Configuration
// =============================================================================

const EXAMPLES_DIR = path.join(__dirname, '../../examples')
const EXAMPLES_DOMAIN = process.env.EXAMPLES_DOMAIN || 'example.org.ai'
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token-for-e2e'

// Skip deployed tests if not in CI or no explicit domain set
const SKIP_DEPLOYED_TESTS = !process.env.EXAMPLES_DOMAIN && !process.env.CI

// Get URL for an example (the folder name IS the full domain)
function getExampleUrl(exampleFolder: string): string {
  // Folder name is like "crm.example.org.ai"
  return `https://${exampleFolder}`
}

// Get namespace from folder name (e.g., "crm.example.org.ai" → "crm")
function getNamespace(exampleFolder: string): string {
  return exampleFolder.replace(`.${EXAMPLES_DOMAIN}`, '')
}

// =============================================================================
// Example Discovery
// =============================================================================

function getExamples(): string[] {
  try {
    return fs.readdirSync(EXAMPLES_DIR).filter(name => {
      const examplePath = path.join(EXAMPLES_DIR, name)
      // Must be a directory and end with the domain
      return fs.statSync(examplePath).isDirectory() && name.endsWith(`.${EXAMPLES_DOMAIN}`)
    })
  } catch {
    return []
  }
}

const EXAMPLES = getExamples()

// =============================================================================
// Example Configuration Validation
// =============================================================================

describe('Example Structure Validation', () => {
  it(`found ${EXAMPLES.length} examples`, () => {
    console.log(`\n📦 Examples found: ${EXAMPLES.length}`)
    EXAMPLES.forEach(e => console.log(`   - ${e}`))
    expect(EXAMPLES.length).toBeGreaterThan(0)
  })

  it.each(EXAMPLES)('%s has README.md', (example) => {
    const readmePath = path.join(EXAMPLES_DIR, example, 'README.md')
    expect(fs.existsSync(readmePath)).toBe(true)
  })
})

// =============================================================================
// Deployed Examples Health Checks
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('Deployed Examples Health Checks', () => {
  it.each(EXAMPLES)('%s responds to health check', async (example) => {
    const url = getExampleUrl(example)
    const response = await fetch(`${url}/health`)

    expect(response.status).toBe(200)
  })
})

// =============================================================================
// RPC Client Connectivity
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('RPC Client Connectivity', () => {
  it.each(EXAMPLES)('%s accepts RPC client', async (example) => {
    const url = getExampleUrl(example)

    const client = createRPCClient({
      target: url,
      auth: TEST_TOKEN,
    })

    expect(client).toBeDefined()
    expect(client.$meta).toBeDefined()

    const version = await client.$meta.version()
    expect(version).toHaveProperty('major')
  })
})

// =============================================================================
// Specific Example Tests
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('crm.example.org.ai', () => {
  const url = `https://crm.${EXAMPLES_DOMAIN}`

  interface CRMAPI {
    create(type: string, data: Record<string, unknown>): Promise<{ $id: string }>
    listThings(type: string): Promise<Record<string, unknown>[]>
    Customer: {
      create(data: Record<string, unknown>): Promise<{ $id: string }>
      list(): Promise<Record<string, unknown>[]>
    }
  }

  it('supports Customer CRUD', async () => {
    const client = createRPCClient<CRMAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const testId = `crm-test-${Date.now()}`

    // Create
    const created = await client.Customer.create({
      $id: testId,
      name: 'Test Contact',
      email: 'test@example.com',
    })
    expect(created.$id).toBe(testId)

    // List
    const list = await client.Customer.list()
    expect(Array.isArray(list)).toBe(true)
  })

  it('supports Company entities', async () => {
    const client = createRPCClient<CRMAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const company = await client.create('Company', {
      $id: `company-${Date.now()}`,
      name: 'Acme Corp',
      industry: 'Technology',
    })

    expect(company.$id).toBeDefined()
  })

  it('supports Deal entities', async () => {
    const client = createRPCClient<CRMAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const deal = await client.create('Deal', {
      $id: `deal-${Date.now()}`,
      name: 'Enterprise Sale',
      value: 50000,
      stage: 'discovery',
    })

    expect(deal.$id).toBeDefined()
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('redis.example.org.ai', () => {
  const url = `https://redis.${EXAMPLES_DOMAIN}`

  interface RedisAPI {
    set(key: string, value: string): Promise<'OK'>
    get(key: string): Promise<string | null>
    del(key: string): Promise<number>
    incr(key: string): Promise<number>
    expire(key: string, seconds: number): Promise<number>
  }

  it('supports SET/GET', async () => {
    const client = createRPCClient<RedisAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const key = `test-${Date.now()}`

    const setResult = await client.set(key, 'hello')
    expect(setResult).toBe('OK')

    const value = await client.get(key)
    expect(value).toBe('hello')

    await client.del(key)
  })

  it('supports INCR', async () => {
    const client = createRPCClient<RedisAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const key = `counter-${Date.now()}`

    const val1 = await client.incr(key)
    expect(val1).toBe(1)

    const val2 = await client.incr(key)
    expect(val2).toBe(2)

    await client.del(key)
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('chat.example.org.ai', () => {
  const url = `https://chat.${EXAMPLES_DOMAIN}`

  interface ChatAPI {
    sendMessage(room: string, message: { content: string; author: string }): Promise<{ id: string }>
    getMessages(room: string, limit?: number): Promise<{ id: string; content: string }[]>
    joinRoom(room: string, userId: string): Promise<void>
  }

  it('supports sending messages', async () => {
    const client = createRPCClient<ChatAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const room = `room-${Date.now()}`

    const sent = await client.sendMessage(room, {
      content: 'Hello!',
      author: 'test-user',
    })

    expect(sent.id).toBeDefined()
  })

  it('supports getting messages', async () => {
    const client = createRPCClient<ChatAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const room = `room-${Date.now()}`

    // Send a message first
    await client.sendMessage(room, {
      content: 'Test message',
      author: 'test-user',
    })

    const messages = await client.getMessages(room)
    expect(Array.isArray(messages)).toBe(true)
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('queue.example.org.ai', () => {
  const url = `https://queue.${EXAMPLES_DOMAIN}`

  interface QueueAPI {
    enqueue(queue: string, data: Record<string, unknown>): Promise<{ id: string }>
    dequeue(queue: string): Promise<{ id: string; data: Record<string, unknown> } | null>
    peek(queue: string): Promise<{ id: string; data: Record<string, unknown> } | null>
    length(queue: string): Promise<number>
  }

  it('supports enqueue/dequeue', async () => {
    const client = createRPCClient<QueueAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const queue = `queue-${Date.now()}`

    // Enqueue
    const enqueued = await client.enqueue(queue, { task: 'process' })
    expect(enqueued.id).toBeDefined()

    // Peek
    const peeked = await client.peek(queue)
    expect(peeked?.data.task).toBe('process')

    // Dequeue
    const dequeued = await client.dequeue(queue)
    expect(dequeued?.data.task).toBe('process')
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('workflow.example.org.ai', () => {
  const url = `https://workflow.${EXAMPLES_DOMAIN}`

  interface WorkflowAPI {
    emit(event: { type: string; data: Record<string, unknown> }): Promise<{ id: string }>
    listEvents(type?: string): Promise<Record<string, unknown>[]>
  }

  it('supports event emission', async () => {
    const client = createRPCClient<WorkflowAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const result = await client.emit({
      type: 'Customer.signup',
      data: { customerId: `customer-${Date.now()}` },
    })

    expect(result.id).toBeDefined()
  })
})

// =============================================================================
// Coverage Summary
// =============================================================================

describe('Example Coverage Summary', () => {
  it('reports coverage', () => {
    console.log(`\n📊 Example Coverage:`)
    console.log(`   Total: ${EXAMPLES.length} examples`)
    console.log(`   Domain: ${EXAMPLES_DOMAIN}`)

    if (SKIP_DEPLOYED_TESTS) {
      console.log(`\n⚠️  Deployed tests skipped`)
      console.log(`   Set EXAMPLES_DOMAIN=example.org.ai to enable`)
    }
  })
})
