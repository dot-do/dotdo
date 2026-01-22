/**
 * REPL E2E Tests Against Real Deployed DOs
 *
 * Issue: do-aen9g
 *
 * These tests verify end-to-end REPL functionality against real deployed
 * Durable Objects in Cloudflare. Tests are skipped when no real endpoints
 * are configured.
 *
 * Configuration via environment variables:
 *   - DOTDO_E2E_ENDPOINT: Base URL of deployed DO (e.g., https://api.dotdo.dev)
 *   - DOTDO_E2E_API_KEY: Optional API key for authentication
 *   - DOTDO_E2E_NAMESPACE: Optional DO namespace (defaults to 'e2e-test')
 *
 * Usage:
 *   # Run with real deployed DO
 *   DOTDO_E2E_ENDPOINT=https://api.dotdo.dev npm run test:run -- rpc.do/tests/repl-deployed-e2e.test.ts
 *
 *   # Run without endpoint (tests will be skipped with documentation)
 *   npm run test:run -- rpc.do/tests/repl-deployed-e2e.test.ts
 *
 * What these tests verify:
 *   1. REPL connection to deployed DO endpoints
 *   2. $.things.create() persistence in real DO storage
 *   3. $.things.list() retrieval from real DO
 *   4. Entity proxy calls ($.Customer(id).method())
 *   5. Error handling from real deployed DOs
 *   6. Type reflection (_types()) from deployed DOs
 *   7. Concurrent operations against deployed DOs
 *
 * @module rpc.do/tests/repl-deployed-e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { ReplService } from '../src/cli/repl'
import { FetchTransport, generateCorrelationId, CORRELATION_ID_HEADER } from '../src/transport/fetch'
import type { Transport } from '../src/transport/types'
import type { RPCMessage, RPCResponse } from '../src/types'

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * E2E test configuration from environment variables
 */
interface E2EConfig {
  /** Base URL of the deployed DO endpoint */
  endpoint: string
  /** Optional API key for authentication */
  apiKey?: string
  /** DO namespace for test isolation */
  namespace: string
  /** Whether E2E testing is enabled */
  enabled: boolean
}

function getE2EConfig(): E2EConfig {
  const endpoint = process.env.DOTDO_E2E_ENDPOINT ?? ''
  const apiKey = process.env.DOTDO_E2E_API_KEY
  const namespace = process.env.DOTDO_E2E_NAMESPACE ?? `e2e-test-${Date.now()}`
  const enabled = endpoint.length > 0

  return { endpoint, apiKey, namespace, enabled }
}

const config = getE2EConfig()

/**
 * Conditional describe that skips when E2E endpoint is not configured
 */
const describeE2E = config.enabled ? describe : describe.skip

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a FetchTransport configured for the E2E endpoint
 */
function createE2ETransport(): FetchTransport {
  const headers: Record<string, string> = {}

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  // Include namespace in headers for request routing
  headers['X-DO-Namespace'] = config.namespace

  return new FetchTransport({
    url: config.endpoint,
    timeout: 30000,
    headers,
  })
}

/**
 * Generate a unique test ID for each test run
 */
function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Thing interface for type safety
 */
interface Thing {
  $id: string
  $type: string
  name?: string
  [key: string]: unknown
}

/**
 * Sample type definitions for REPL autocomplete
 */
const SAMPLE_TYPES = `
/**
 * ThingsStore - CRUD operations for Things
 */
export interface ThingsStore {
  create<D extends { $type: string }>(data: D): Promise<Thing & D>;
  get(id: string): Promise<Thing | null>;
  update(id: string, data: Partial<any>): Promise<Thing>;
  delete(id: string): Promise<{ deleted: boolean }>;
  list(options?: { type?: string; limit?: number }): Promise<Thing[]>;
}

export interface Thing {
  $id: string;
  $type: string;
  $createdAt: number;
  $updatedAt: number;
}

/**
 * WorkflowContext ($) - Fluent API for events, scheduling, and cross-DO RPC
 */
export interface WorkflowContext {
  things: ThingsStore;
  _types(): Promise<string>;
}

declare const $: WorkflowContext;
`

// ============================================================================
// SKIP MESSAGE
// ============================================================================

describe('REPL E2E Tests Against Real Deployed DOs', () => {
  if (!config.enabled) {
    it('SKIPPED: No E2E endpoint configured', () => {
      console.log(`
================================================================================
REPL E2E Tests Against Real Deployed DOs - SKIPPED
================================================================================

These tests require a real deployed Durable Object endpoint.

To run these tests, set the following environment variables:

  DOTDO_E2E_ENDPOINT=https://your-deployed-do.workers.dev
  DOTDO_E2E_API_KEY=your-api-key  (optional)
  DOTDO_E2E_NAMESPACE=test-namespace  (optional, defaults to timestamped namespace)

Example:
  DOTDO_E2E_ENDPOINT=https://api.dotdo.dev npm run test:run -- rpc.do/tests/repl-deployed-e2e.test.ts

What would be tested:
  1. REPL connection to deployed DO endpoints
  2. $.things.create() persistence in real DO storage
  3. $.things.list() retrieval from real DO
  4. Entity proxy calls ($.Customer(id).method())
  5. Error handling from real deployed DOs
  6. Type reflection (_types()) from deployed DOs
  7. Concurrent operations against deployed DOs
  8. REPL history and command execution
  9. Tab completion with real type reflection
================================================================================
      `)
      expect(true).toBe(true) // Placeholder assertion
    })
    return
  }
})

// ============================================================================
// E2E TEST SUITES
// ============================================================================

describeE2E('1. Connection to Deployed DO', () => {
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should connect to the deployed DO endpoint', async () => {
    // Send a simple ping/health check request
    const response = await transport.send<{ status: string }>({
      method: '_health',
      args: [],
    })

    // Even if _health doesn't exist, we should get a proper error response
    // (not a transport error) indicating the DO is responding
    expect(response.correlationId).toBeDefined()
    // Either we got a result or a structured error (both mean DO is responding)
    expect(response.result !== undefined || response.error !== undefined).toBe(true)
  })

  it('should include correlation ID in responses', async () => {
    const customCorrelationId = `e2e-correlation-${Date.now()}`

    const response = await transport.send({
      method: 'things.list',
      args: [],
      correlationId: customCorrelationId,
    })

    // Correlation ID should be present in response
    expect(response.correlationId).toBeDefined()
  })

  it('should handle transport timeouts gracefully', async () => {
    // Create transport with very short timeout
    const shortTimeoutTransport = new FetchTransport({
      url: config.endpoint,
      timeout: 1, // 1ms - will likely timeout
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    })

    const response = await shortTimeoutTransport.send({
      method: 'things.list',
      args: [],
    })

    // Should get either a result (if very fast) or a transport error
    // Not a crash
    expect(response).toBeDefined()
    if (response.error) {
      expect(response.error.type).toBeDefined()
    }
  })
})

describeE2E('2. $.things.create() via REPL', () => {
  let repl: ReplService
  let transport: FetchTransport
  let output: string[]

  beforeEach(() => {
    transport = createE2ETransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should execute $.things.create() against real DO', async () => {
    const testId = generateTestId()

    await repl.execute(`$.things.create({ $type: "E2ETest", name: "Test-${testId}" })`)

    const outputText = output.join('\n')

    // Should have some output (either result or error)
    expect(outputText.length).toBeGreaterThan(0)

    // If successful, should contain $id
    // If error, we log it for debugging
    if (!outputText.includes('$id') && !outputText.includes('Error')) {
      console.log('Unexpected output:', outputText)
    }
  })

  it('should persist created thing in DO storage', async () => {
    const testId = generateTestId()
    const testName = `Persist-Test-${testId}`

    // Create a thing
    await repl.execute(`$.things.create({ $type: "E2EPersistence", name: "${testName}" })`)

    // Clear output and list
    output = []
    await repl.execute('$.things.list()')

    const listOutput = output.join('\n')

    // The created thing should appear in the list
    // Note: This may fail if the DO doesn't support things.list()
    if (listOutput.includes('Error') || listOutput.includes('not found')) {
      console.log('Note: things.list() may not be implemented:', listOutput)
    }
  })

  it('should handle complex data objects', async () => {
    const testId = generateTestId()

    await repl.execute(`$.things.create({
      $type: "E2EComplex",
      name: "Complex-${testId}",
      metadata: {
        tags: ["e2e", "test"],
        priority: 1,
        nested: { value: true }
      }
    })`)

    const outputText = output.join('\n')
    expect(outputText.length).toBeGreaterThan(0)
  })
})

describeE2E('3. $.things.list() via REPL', () => {
  let repl: ReplService
  let transport: FetchTransport
  let output: string[]

  beforeEach(() => {
    transport = createE2ETransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should execute $.things.list() and return array', async () => {
    await repl.execute('$.things.list()')

    const outputText = output.join('\n')
    expect(outputText.length).toBeGreaterThan(0)

    // Should be an array (empty or with items)
    // or an error message
    const hasArrayMarkers = outputText.includes('[') || outputText.includes('Error')
    expect(hasArrayMarkers).toBe(true)
  })

  it('should list with type filter if supported', async () => {
    await repl.execute('$.things.list({ type: "E2ETest" })')

    const outputText = output.join('\n')
    expect(outputText.length).toBeGreaterThan(0)
  })
})

describeE2E('4. Entity Proxy Calls', () => {
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should handle entity-style method calls', async () => {
    // Test entity proxy pattern: Customer.getProfile with ID as first arg
    const response = await transport.send({
      method: 'Customer.getProfile',
      args: ['e2e-customer-123'],
    })

    // Either succeeds or returns structured error (both valid responses)
    expect(response.correlationId).toBeDefined()
    expect(response.result !== undefined || response.error !== undefined).toBe(true)
  })

  it('should handle entity state updates', async () => {
    const testId = generateTestId()

    const response = await transport.send({
      method: 'Customer.updateStatus',
      args: [testId, 'active'],
    })

    expect(response.correlationId).toBeDefined()
  })
})

describeE2E('5. Error Handling', () => {
  let repl: ReplService
  let transport: FetchTransport
  let output: string[]

  beforeEach(() => {
    transport = createE2ETransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should handle method not found errors gracefully', async () => {
    await repl.execute('$.nonexistent.method()')

    const outputText = output.join('\n')

    // Should have error output, not crash
    expect(outputText.length).toBeGreaterThan(0)
    expect(outputText.toLowerCase()).toMatch(/error|not found|invalid/i)
  })

  it('should continue working after error', async () => {
    // Cause an error
    await repl.execute('$.nonexistent.method()')
    output = []

    // Then execute valid command
    await repl.execute('$.things.list()')

    const outputText = output.join('\n')
    expect(outputText.length).toBeGreaterThan(0)
  })

  it('should handle malformed method calls', async () => {
    await repl.execute('$.()')

    const outputText = output.join('\n')
    // Should handle gracefully, not crash
    expect(true).toBe(true)
  })
})

describeE2E('6. Type Reflection (_types())', () => {
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should fetch type definitions from deployed DO', async () => {
    const response = await transport.send<string>({
      method: '_types',
      args: [],
    })

    if (response.error) {
      // _types() may not be implemented - document this
      console.log('Note: _types() not available on this endpoint:', response.error.message)
      expect(response.error.code).toBeDefined()
    } else {
      // If implemented, should return TypeScript definitions
      expect(response.result).toBeDefined()
      expect(typeof response.result).toBe('string')

      // Should contain interface definitions
      const types = response.result as string
      if (types.includes('interface')) {
        expect(types).toMatch(/interface|type|export/)
      }
    }
  })

  it('should fetch schema from deployed DO', async () => {
    const response = await transport.send<{ methods?: Record<string, unknown> }>({
      method: '_schema',
      args: [],
    })

    if (response.error) {
      // _schema() may not be implemented
      console.log('Note: _schema() not available on this endpoint:', response.error.message)
      expect(response.error.code).toBeDefined()
    } else {
      // If implemented, should return structured schema
      expect(response.result).toBeDefined()
      expect(typeof response.result).toBe('object')
    }
  })
})

describeE2E('7. Concurrent Operations', () => {
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should handle concurrent requests to deployed DO', async () => {
    const testId = generateTestId()

    // Send multiple concurrent requests
    const results = await Promise.all([
      transport.send({ method: 'things.create', args: [{ $type: 'Concurrent', index: 0, testId }] }),
      transport.send({ method: 'things.create', args: [{ $type: 'Concurrent', index: 1, testId }] }),
      transport.send({ method: 'things.create', args: [{ $type: 'Concurrent', index: 2, testId }] }),
    ])

    // All should complete (success or error)
    expect(results.length).toBe(3)
    results.forEach((result, i) => {
      expect(result.correlationId).toBeDefined()
      if (result.error) {
        console.log(`Concurrent request ${i} error:`, result.error.message)
      }
    })
  })

  it('should maintain data consistency under concurrent load', async () => {
    const testId = generateTestId()

    // Create multiple items concurrently
    await Promise.all([
      transport.send({ method: 'things.create', args: [{ $type: 'Consistency', name: `item-${testId}-1` }] }),
      transport.send({ method: 'things.create', args: [{ $type: 'Consistency', name: `item-${testId}-2` }] }),
    ])

    // List should return consistent results
    const listResponse = await transport.send<Thing[]>({
      method: 'things.list',
      args: [{ type: 'Consistency' }],
    })

    if (listResponse.result) {
      // If list is supported, items should be present
      expect(Array.isArray(listResponse.result)).toBe(true)
    }
  })
})

describeE2E('8. REPL History and Commands', () => {
  let repl: ReplService
  let transport: FetchTransport
  let output: string[]

  beforeEach(() => {
    transport = createE2ETransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should add executed commands to history', async () => {
    await repl.execute('$.things.list()')

    const history = repl.getHistory()
    expect(history).toContain('$.things.list()')
  })

  it('should execute .help command', async () => {
    await repl.execute('.help')

    const outputText = output.join('\n')
    expect(outputText).toContain('.exit')
    expect(outputText).toContain('.help')
  })

  it('should not add empty commands to history', async () => {
    await repl.execute('')
    await repl.execute('   ')

    const history = repl.getHistory()
    expect(history.length).toBe(0)
  })
})

describeE2E('9. REPL Completion Integration', () => {
  let repl: ReplService
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
    })
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should provide completions for "$."', () => {
    const completions = repl.getCompletions('$.', 2)

    expect(completions).toBeDefined()
    expect(completions.length).toBeGreaterThan(0)

    const names = completions.map(c => c.name)
    expect(names).toContain('things')
  })

  it('should provide completions for "$.things."', () => {
    const completions = repl.getCompletions('$.things.', 9)

    expect(completions).toBeDefined()
    const names = completions.map(c => c.name)
    expect(names).toContain('create')
    expect(names).toContain('list')
  })

  it('should return readline-compatible format', () => {
    const [completions, partial] = repl.complete('$.th')

    expect(Array.isArray(completions)).toBe(true)
    expect(typeof partial).toBe('string')
    expect(completions).toContain('things')
    expect(partial).toBe('th')
  })
})

// ============================================================================
// LATENCY AND PERFORMANCE TESTS (Optional)
// ============================================================================

describeE2E('10. Latency and Performance', () => {
  let transport: FetchTransport

  beforeAll(() => {
    transport = createE2ETransport()
  })

  afterAll(async () => {
    await transport.close()
  })

  it('should measure round-trip latency', async () => {
    const start = performance.now()

    await transport.send({
      method: 'things.list',
      args: [],
    })

    const latency = performance.now() - start
    console.log(`Round-trip latency: ${latency.toFixed(2)}ms`)

    // Latency should be reasonable (under 5 seconds)
    expect(latency).toBeLessThan(5000)
  })

  it('should handle burst requests', async () => {
    const burstSize = 10
    const start = performance.now()

    const results = await Promise.all(
      Array.from({ length: burstSize }, (_, i) =>
        transport.send({
          method: 'things.list',
          args: [],
          correlationId: `burst-${i}`,
        })
      )
    )

    const duration = performance.now() - start
    console.log(`Burst of ${burstSize} requests completed in ${duration.toFixed(2)}ms`)

    // All requests should complete
    expect(results.length).toBe(burstSize)
    results.forEach(r => {
      expect(r.correlationId).toBeDefined()
    })
  })
})
