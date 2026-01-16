/**
 * Examples E2E Tests
 *
 * Tests that all examples in /examples are:
 * 1. Deployable (valid wrangler config)
 * 2. Functional (respond to health checks and basic operations)
 * 3. RPC-compatible (work with createRPCClient)
 *
 * Configuration:
 *   EXAMPLES_BASE_URL - Base URL pattern for deployed examples
 *                       e.g., "https://{example}.examples.dotdo.dev"
 *   TEST_TOKEN - Auth token for protected endpoints
 *
 * @example
 * ```bash
 * # Test all deployed examples
 * EXAMPLES_BASE_URL="https://{example}.examples.dotdo.dev" npm run test:e2e
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
const EXAMPLES_BASE_URL = process.env.EXAMPLES_BASE_URL || 'http://localhost:8787'
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token-for-e2e'

// Skip deployed tests if no base URL configured
const SKIP_DEPLOYED_TESTS = !process.env.EXAMPLES_BASE_URL && !process.env.CI

// Get URL for an example
function getExampleUrl(example: string): string {
  return EXAMPLES_BASE_URL.replace('{example}', example)
}

// =============================================================================
// Example Discovery
// =============================================================================

// Get all example directories
function getExamples(): string[] {
  try {
    return fs.readdirSync(EXAMPLES_DIR).filter(name => {
      const examplePath = path.join(EXAMPLES_DIR, name)
      return fs.statSync(examplePath).isDirectory()
    })
  } catch {
    return []
  }
}

const EXAMPLES = getExamples()

// =============================================================================
// Example Configuration Validation
// =============================================================================

describe('Example Configuration Validation', () => {
  it.each(EXAMPLES)('%s has valid structure', (example) => {
    const examplePath = path.join(EXAMPLES_DIR, example)

    // Check for README.md (documentation)
    const hasReadme = fs.existsSync(path.join(examplePath, 'README.md'))
    expect(hasReadme).toBe(true)
  })

  it.each(EXAMPLES.filter(e =>
    fs.existsSync(path.join(EXAMPLES_DIR, e, 'wrangler.toml'))
  ))('%s has valid wrangler.toml', (example) => {
    const wranglerPath = path.join(EXAMPLES_DIR, example, 'wrangler.toml')
    const content = fs.readFileSync(wranglerPath, 'utf-8')

    // Should have a name
    expect(content).toMatch(/name\s*=/)
    // Should have a main entry point
    expect(content).toMatch(/main\s*=/)
    // Should have compatibility date
    expect(content).toMatch(/compatibility_date\s*=/)
  })

  it.each(EXAMPLES.filter(e =>
    fs.existsSync(path.join(EXAMPLES_DIR, e, 'package.json'))
  ))('%s has valid package.json', (example) => {
    const pkgPath = path.join(EXAMPLES_DIR, example, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

    // Should have required fields
    expect(pkg.name).toBeDefined()
    expect(pkg.scripts?.dev || pkg.scripts?.start).toBeDefined()
  })
})

// =============================================================================
// Deployable Examples (have wrangler.toml and index.ts)
// =============================================================================

const DEPLOYABLE_EXAMPLES = EXAMPLES.filter(example => {
  const examplePath = path.join(EXAMPLES_DIR, example)
  return (
    fs.existsSync(path.join(examplePath, 'wrangler.toml')) &&
    fs.existsSync(path.join(examplePath, 'index.ts'))
  )
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('Deployed Examples Health Checks', () => {
  it.each(DEPLOYABLE_EXAMPLES)('%s responds to health check', async (example) => {
    const url = getExampleUrl(example)

    const response = await fetch(`${url}/health`)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('ok')
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('Deployed Examples RPC Compatibility', () => {
  it.each(DEPLOYABLE_EXAMPLES)('%s accepts RPC client connections', async (example) => {
    const url = getExampleUrl(example)

    const client = createRPCClient({
      target: url,
      auth: TEST_TOKEN,
    })

    expect(client).toBeDefined()
    expect(client.$meta).toBeDefined()

    // Try to get version (should work for all examples)
    const version = await client.$meta.version()
    expect(version).toHaveProperty('major')
  })
})

// =============================================================================
// Specific Example Tests
// =============================================================================

describe.skipIf(SKIP_DEPLOYED_TESTS)('simple-api Example', () => {
  const url = getExampleUrl('simple-api')

  interface SimpleAPI {
    create(type: string, data: Record<string, unknown>): Promise<{ $id: string }>
    get(type: string, id: string): Promise<Record<string, unknown> | null>
    list(type: string): Promise<Record<string, unknown>[]>
  }

  it('supports CRUD operations', async () => {
    const client = createRPCClient<SimpleAPI>({ target: url })
    const testId = `simple-test-${Date.now()}`

    // Create
    const created = await client.create('Customer', {
      $id: testId,
      name: 'Simple Test',
    })
    expect(created.$id).toBe(testId)

    // Read
    const read = await client.get('Customer', testId)
    expect(read).not.toBeNull()
    expect((read as { name: string }).name).toBe('Simple Test')

    // List
    const list = await client.list('Customer')
    expect(Array.isArray(list)).toBe(true)
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('auth-api Example', () => {
  const url = getExampleUrl('auth-api')

  interface AuthAPI {
    create(type: string, data: Record<string, unknown>): Promise<{ $id: string }>
    list(type: string): Promise<Record<string, unknown>[]>
  }

  it('allows read without auth', async () => {
    const client = createRPCClient<AuthAPI>({ target: url })

    // Should work without auth
    const list = await client.list('Customer')
    expect(Array.isArray(list)).toBe(true)
  })

  it('requires auth for write', async () => {
    const client = createRPCClient<AuthAPI>({ target: url })

    // Should fail without auth
    await expect(
      client.create('Customer', { name: 'Unauthorized' })
    ).rejects.toThrow()
  })

  it('allows write with auth', async () => {
    const client = createRPCClient<AuthAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const result = await client.create('Customer', {
      $id: `auth-test-${Date.now()}`,
      name: 'Authorized',
    })

    expect(result.$id).toBeDefined()
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('crm Example', () => {
  const url = getExampleUrl('crm')

  interface CRMAPI {
    create(type: string, data: Record<string, unknown>): Promise<{ $id: string }>
    list(type: string): Promise<Record<string, unknown>[]>
  }

  it('supports CRM entities', async () => {
    const client = createRPCClient<CRMAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    // Create Contact
    const contact = await client.create('Contact', {
      $id: `crm-contact-${Date.now()}`,
      name: 'Alice Chen',
      email: 'alice@example.com',
    })
    expect(contact.$id).toBeDefined()

    // Create Company
    const company = await client.create('Company', {
      $id: `crm-company-${Date.now()}`,
      name: 'Acme Corp',
    })
    expect(company.$id).toBeDefined()

    // Create Deal
    const deal = await client.create('Deal', {
      $id: `crm-deal-${Date.now()}`,
      name: 'Enterprise Sale',
      value: 50000,
      stage: 'discovery',
    })
    expect(deal.$id).toBeDefined()
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('workflow Example', () => {
  const url = getExampleUrl('workflow')

  interface WorkflowAPI {
    emit(event: { type: string; data: Record<string, unknown> }): Promise<void>
    list(type: string): Promise<Record<string, unknown>[]>
  }

  it('supports event emission', async () => {
    const client = createRPCClient<WorkflowAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    // Emit event
    await client.emit({
      type: 'Customer.signup',
      data: { customerId: `workflow-test-${Date.now()}` },
    })

    // Events should be processed
    // (actual verification depends on workflow implementation)
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('chat Example', () => {
  const url = getExampleUrl('chat')

  interface ChatAPI {
    sendMessage(room: string, message: { content: string; author: string }): Promise<{ id: string }>
    getMessages(room: string): Promise<{ id: string; content: string }[]>
  }

  it('supports chat operations', async () => {
    const client = createRPCClient<ChatAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const room = `test-room-${Date.now()}`

    // Send message
    const sent = await client.sendMessage(room, {
      content: 'Hello, World!',
      author: 'test-user',
    })
    expect(sent.id).toBeDefined()

    // Get messages
    const messages = await client.getMessages(room)
    expect(Array.isArray(messages)).toBe(true)
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('redis Example', () => {
  const url = getExampleUrl('redis')

  interface RedisAPI {
    set(key: string, value: string): Promise<'OK'>
    get(key: string): Promise<string | null>
    del(key: string): Promise<number>
  }

  it('supports Redis-like operations', async () => {
    const client = createRPCClient<RedisAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const key = `test-key-${Date.now()}`

    // SET
    const setResult = await client.set(key, 'test-value')
    expect(setResult).toBe('OK')

    // GET
    const value = await client.get(key)
    expect(value).toBe('test-value')

    // DEL
    const delResult = await client.del(key)
    expect(delResult).toBe(1)

    // GET after DEL
    const afterDel = await client.get(key)
    expect(afterDel).toBeNull()
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('queue Example', () => {
  const url = getExampleUrl('queue')

  interface QueueAPI {
    enqueue(queue: string, message: Record<string, unknown>): Promise<{ id: string }>
    dequeue(queue: string): Promise<{ id: string; data: Record<string, unknown> } | null>
    peek(queue: string): Promise<{ id: string; data: Record<string, unknown> } | null>
  }

  it('supports queue operations', async () => {
    const client = createRPCClient<QueueAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const queue = `test-queue-${Date.now()}`

    // Enqueue
    const enqueued = await client.enqueue(queue, { task: 'process-data' })
    expect(enqueued.id).toBeDefined()

    // Peek
    const peeked = await client.peek(queue)
    expect(peeked).not.toBeNull()
    expect(peeked?.data.task).toBe('process-data')

    // Dequeue
    const dequeued = await client.dequeue(queue)
    expect(dequeued).not.toBeNull()
    expect(dequeued?.data.task).toBe('process-data')
  })
})

describe.skipIf(SKIP_DEPLOYED_TESTS)('ratelimit Example', () => {
  const url = getExampleUrl('ratelimit')

  interface RateLimitAPI {
    check(key: string): Promise<{ allowed: boolean; remaining: number; reset: number }>
    consume(key: string, tokens?: number): Promise<{ allowed: boolean; remaining: number }>
  }

  it('supports rate limiting', async () => {
    const client = createRPCClient<RateLimitAPI>({
      target: url,
      auth: TEST_TOKEN,
    })

    const key = `test-ratelimit-${Date.now()}`

    // Check
    const check = await client.check(key)
    expect(check.allowed).toBe(true)
    expect(typeof check.remaining).toBe('number')

    // Consume
    const consumed = await client.consume(key)
    expect(consumed.allowed).toBe(true)
  })
})

// =============================================================================
// Summary Stats
// =============================================================================

describe('Example Coverage Summary', () => {
  it('reports example coverage', () => {
    console.log(`\n📊 Example Coverage:`)
    console.log(`   Total examples: ${EXAMPLES.length}`)
    console.log(`   Deployable: ${DEPLOYABLE_EXAMPLES.length}`)
    console.log(`   Documentation only: ${EXAMPLES.length - DEPLOYABLE_EXAMPLES.length}`)

    if (SKIP_DEPLOYED_TESTS) {
      console.log(`\n⚠️  Deployed tests skipped (set EXAMPLES_BASE_URL to enable)`)
    }
  })
})
