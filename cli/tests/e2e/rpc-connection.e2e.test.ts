/**
 * RPC Connection E2E Tests
 *
 * End-to-end tests for WebSocket RPC connection behavior.
 * Tests cover connection lifecycle, reconnection, and error handling.
 *
 * RED PHASE: These tests define expected behavior for RPC integration.
 * Many tests require WebSocket mocking which is not yet fully implemented.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import {
  renderRepl,
  MockRpcServer,
  delay,
  stripAnsi,
  type ReplTestInstance,
} from './test-utils.js'

describe('RPC Connection E2E', () => {
  let repl: ReplTestInstance | null = null
  let server: MockRpcServer

  beforeEach(() => {
    server = new MockRpcServer()
  })

  afterEach(() => {
    if (repl) {
      repl.cleanup()
      repl = null
    }
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Connection Lifecycle Tests
  // ===========================================================================

  describe('connection lifecycle', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until WebSocket mocking
     * is properly integrated with the RpcClient.
     *
     * Expected behavior: REPL should attempt to connect when endpoint is provided.
     */
    it.skip('should attempt connection when endpoint is provided', async () => {
      // This requires WebSocket mocking infrastructure
      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(500)

      const output = repl.getOutput()
      // Should attempt connection (may show connecting or connected)
      expect(
        output.includes('Connecting') ||
        output.includes('connected') ||
        output.includes('Connection')
      ).toBe(true)
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until WebSocket mocking
     * is properly integrated.
     *
     * Expected behavior: When connected, status should show "connected".
     */
    it.skip('should show connected status after successful connection', async () => {
      // Requires WebSocket mock that accepts connections
      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000) // Allow time for connection

      const output = repl.getOutput()
      expect(output).toContain('connected')
      expect(output).not.toContain('disconnected')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until WebSocket mocking
     * is properly integrated.
     *
     * Expected behavior: Connection errors should be displayed to user.
     */
    it.skip('should display connection error on failed connection', async () => {
      repl = renderRepl({
        endpoint: 'ws://invalid.endpoint:9999',
      })

      await delay(1000)

      const output = repl.getOutput()
      // Should show some form of error
      expect(
        output.toLowerCase().includes('error') ||
        output.toLowerCase().includes('failed') ||
        output.toLowerCase().includes('disconnected')
      ).toBe(true)
    })
  })

  // ===========================================================================
  // Schema Loading Tests
  // ===========================================================================

  describe('schema loading', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until schema introspection
     * is properly tested with mocked RPC.
     *
     * Expected behavior: After connection, schema should be loaded from server.
     */
    it.skip('should load schema after successful connection', async () => {
      server.setSchema({
        name: 'TestDO',
        methods: [
          { name: 'getItems', params: [], returns: 'Item[]' },
          { name: 'createItem', params: [{ name: 'data', type: 'object' }], returns: 'Item' },
        ],
      })

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000)

      const output = repl.getOutput()
      // Should show schema was loaded
      expect(output).toContain('TestDO')
      expect(output).toContain('Schema loaded')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until schema-based completions
     * are properly tested.
     *
     * Expected behavior: Schema methods should appear in completions.
     */
    it.skip('should show schema methods in completions', async () => {
      server.setSchema({
        name: 'TestDO',
        methods: [
          { name: 'customMethod', params: [], returns: 'void' },
        ],
      })

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000) // Wait for connection and schema

      // Type to trigger completions
      await repl.type('custom')
      await delay(200)
      repl.tab()
      await delay(100)

      const output = repl.getOutput()
      expect(output).toContain('customMethod')
    })
  })

  // ===========================================================================
  // Code Evaluation Tests
  // ===========================================================================

  describe('code evaluation via RPC', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until RPC evaluation
     * is properly mocked.
     *
     * Expected behavior: Code should be sent to DO for evaluation via RPC.
     */
    it.skip('should evaluate code via RPC and display result', async () => {
      server.on('call', (msg) => {
        if (msg.method === 'evaluate') {
          return {
            type: 'result',
            id: msg.id,
            result: {
              success: true,
              value: 42,
            },
          }
        }
      })

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000) // Wait for connection

      await repl.type('1 + 1')
      repl.submit()

      await delay(500)

      const output = repl.getOutput()
      // Should show the evaluated result
      expect(output).toContain('42')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until streaming logs
     * are properly handled.
     *
     * Expected behavior: Console.log from evaluated code should stream to output.
     */
    it.skip('should display streamed console output', async () => {
      server.on('call', (msg) => {
        if (msg.method === 'evaluate') {
          return {
            type: 'result',
            id: msg.id,
            result: {
              success: true,
              value: undefined,
              logs: [
                { level: 'log', message: 'Hello from DO!' },
              ],
            },
          }
        }
      })

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000)

      await repl.type('console.log("Hello from DO!")')
      repl.submit()

      await delay(500)

      const output = repl.getOutput()
      expect(output).toContain('Hello from DO!')
    })

    /**
     * RED PHASE: This test is EXPECTED TO FAIL until error handling
     * from RPC is properly displayed.
     *
     * Expected behavior: Evaluation errors should be displayed clearly.
     */
    it.skip('should display evaluation errors from RPC', async () => {
      server.on('call', (msg) => {
        if (msg.method === 'evaluate') {
          return {
            type: 'result',
            id: msg.id,
            result: {
              success: false,
              error: 'ReferenceError: foo is not defined',
            },
          }
        }
      })

      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000)

      await repl.type('foo.bar()')
      repl.submit()

      await delay(500)

      const output = repl.getOutput()
      expect(output).toContain('ReferenceError')
      expect(output).toContain('foo is not defined')
    })
  })

  // ===========================================================================
  // Reconnection Tests
  // ===========================================================================

  describe('reconnection behavior', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until auto-reconnect
     * logic is properly testable.
     *
     * Expected behavior: REPL should auto-reconnect after disconnect.
     */
    it.skip('should auto-reconnect after disconnection', async () => {
      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000)

      // Simulate disconnect (would need mock infrastructure)
      // Then verify reconnection attempt

      const output = repl.getOutput()
      expect(output).toContain('Reconnecting')
    })

    /**
     * RED PHASE: This test verifies the .connect command works.
     */
    it('should show warning when reconnecting without endpoint', async () => {
      repl = renderRepl()

      await delay(100)

      await repl.type('.connect')
      repl.submit()

      await delay(100)

      const output = repl.getOutput()
      expect(output.toLowerCase()).toContain('no endpoint')
    })
  })

  // ===========================================================================
  // Event Subscription Tests
  // ===========================================================================

  describe('event subscriptions', () => {
    /**
     * RED PHASE: This test is EXPECTED TO FAIL until event subscription
     * is properly testable with mocks.
     *
     * Expected behavior: Events from DO should be displayed in output.
     */
    it.skip('should display events from DO', async () => {
      repl = renderRepl({
        endpoint: server.getUrl(),
      })

      await delay(1000)

      // Simulate server sending an event
      // Would need mock infrastructure to push events

      const output = repl.getOutput()
      expect(output).toContain('Event:')
    })
  })
})

// ===========================================================================
// Offline Mode Tests
// ===========================================================================

describe('Offline Mode E2E', () => {
  let repl: ReplTestInstance | null = null

  afterEach(() => {
    if (repl) {
      repl.cleanup()
      repl = null
    }
  })

  it('should start in offline mode when no endpoint provided', async () => {
    repl = renderRepl()

    await delay(100)

    const output = repl.getOutput()
    expect(output.toLowerCase()).toContain('offline')
  })

  it('should show disconnected in status bar', async () => {
    repl = renderRepl()

    await delay(100)

    const output = repl.getOutput()
    expect(output).toContain('disconnected')
  })

  /**
   * RED PHASE: This test is EXPECTED TO FAIL until TypeScript completion
   * engine is properly initialized in offline mode.
   *
   * Expected behavior: Math.* completions should appear even without RPC.
   * Current behavior: Completion engine may need more initialization time
   * or TypeScript libs may not be loaded correctly.
   */
  it.fails('should still provide TypeScript completions in offline mode', async () => {
    repl = renderRepl()

    await delay(100)

    // Type to get completions
    await repl.type('const x = Math.')
    await delay(200)

    const output = repl.getOutput()
    // Should show Math completions even without RPC connection
    expect(
      output.includes('floor') ||
      output.includes('ceil') ||
      output.includes('round') ||
      output.includes('PI')
    ).toBe(true)
  })

  it('should show error when trying to evaluate without connection', async () => {
    repl = renderRepl()

    await delay(100)

    await repl.type('1 + 1')
    repl.submit()

    await delay(200)

    const output = repl.getOutput()
    expect(output).toContain('Not connected')
  })

  it('should still allow built-in commands in offline mode', async () => {
    repl = renderRepl()

    await delay(100)

    await repl.type('.help')
    repl.submit()

    await delay(100)

    const output = repl.getOutput()
    expect(output).toContain('Commands')
    expect(output).toContain('.help')
    expect(output).toContain('.clear')
  })
})
