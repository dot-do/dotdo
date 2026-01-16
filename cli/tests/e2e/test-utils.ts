/**
 * E2E Test Utilities
 *
 * Helpers for testing the REPL component with ink-testing-library.
 */

import React from 'react'
import { render, type Instance } from 'ink-testing-library'
import { Repl, type ReplProps } from '../../src/repl.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Mock RPC message types
 */
export interface RpcMessage {
  type: 'introspect' | 'call' | 'subscribe' | 'unsubscribe' | 'ping'
  id?: string
  method?: string
  params?: unknown[]
}

export interface RpcResponse {
  type: 'result' | 'error' | 'event'
  id?: string
  result?: unknown
  error?: { message: string; code?: number }
}

/**
 * Mock WebSocket event handlers
 */
export interface MockWebSocketHandlers {
  onMessage?: (msg: RpcMessage) => RpcResponse | RpcResponse[] | void
  onConnect?: () => void
  onClose?: () => void
}

// =============================================================================
// MockRpcServer
// =============================================================================

/**
 * Mock RPC server for simulating WebSocket responses in tests.
 *
 * Usage:
 * ```ts
 * const server = new MockRpcServer()
 * server.on('introspect', () => ({
 *   type: 'result',
 *   result: { name: 'TestSchema', methods: [] }
 * }))
 * ```
 */
export class MockRpcServer {
  private handlers: Map<string, (msg: RpcMessage) => RpcResponse | RpcResponse[] | void> = new Map()
  private defaultSchema = {
    name: 'TestSchema',
    version: '1.0.0',
    methods: [
      { name: 'echo', params: [{ name: 'message', type: 'string' }], returns: 'string' },
      { name: 'ping', params: [], returns: 'string' },
    ],
  }

  /**
   * Register a handler for a specific message type
   */
  on(type: string, handler: (msg: RpcMessage) => RpcResponse | RpcResponse[] | void): this {
    this.handlers.set(type, handler)
    return this
  }

  /**
   * Handle an incoming message and return a response
   */
  handleMessage(msg: RpcMessage): RpcResponse | RpcResponse[] | undefined {
    const handler = this.handlers.get(msg.type)
    if (handler) {
      return handler(msg)
    }

    // Default handlers for common message types
    switch (msg.type) {
      case 'introspect':
        return {
          type: 'result',
          id: msg.id,
          result: this.defaultSchema,
        }
      case 'ping':
        return {
          type: 'result',
          id: msg.id,
          result: 'pong',
        }
      case 'call':
        return {
          type: 'result',
          id: msg.id,
          result: `Called ${msg.method}`,
        }
      default:
        return undefined
    }
  }

  /**
   * Set a custom schema for introspection responses
   */
  setSchema(schema: { name: string; version?: string; methods: unknown[] }): this {
    this.defaultSchema = { ...this.defaultSchema, ...schema }
    return this
  }

  /**
   * Get the mock WebSocket URL for this server
   */
  getUrl(): string {
    return 'ws://localhost:9999/test'
  }
}

// =============================================================================
// REPL Render Helpers
// =============================================================================

/**
 * Rendered REPL instance with test helpers
 */
export interface ReplTestInstance {
  /** The ink render instance */
  instance: Instance
  /** Get the current frame output */
  getOutput: () => string
  /** Type a key into the REPL */
  press: (key: string) => void
  /** Type a string into the REPL (with delay between characters) */
  type: (text: string) => Promise<void>
  /** Press Enter to submit */
  submit: () => void
  /** Press Tab for completion */
  tab: () => void
  /** Press Up arrow for history/completion navigation */
  up: () => void
  /** Press Down arrow for history/completion navigation */
  down: () => void
  /** Cleanup the instance */
  cleanup: () => void
  /** Wait for output to contain specific text */
  waitForText: (text: string, timeout?: number) => Promise<void>
  /** Wait for any output change */
  waitForUpdate: (timeout?: number) => Promise<void>
}

/**
 * Render the REPL component for testing.
 *
 * @param props - Props to pass to the Repl component
 * @returns Test instance with helpers
 */
export function renderRepl(props: ReplProps = {}): ReplTestInstance {
  const instance = render(React.createElement(Repl, props))

  const getOutput = (): string => {
    return instance.lastFrame() ?? ''
  }

  const press = (key: string): void => {
    instance.stdin.write(key)
  }

  // Type with small delays between characters to allow React to process
  const type = async (text: string): Promise<void> => {
    for (const char of text) {
      instance.stdin.write(char)
      // Small delay to allow React state updates
      await delay(10)
    }
  }

  const submit = (): void => {
    instance.stdin.write('\r')
  }

  const tab = (): void => {
    instance.stdin.write('\t')
  }

  const up = (): void => {
    instance.stdin.write('\x1B[A') // ANSI escape for up arrow
  }

  const down = (): void => {
    instance.stdin.write('\x1B[B') // ANSI escape for down arrow
  }

  const cleanup = (): void => {
    instance.unmount()
  }

  const waitForText = async (text: string, timeout = 5000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const output = getOutput()
      if (output.includes(text)) {
        return
      }
      await delay(50)
    }
    throw new Error(`Timeout waiting for text: "${text}"\nCurrent output:\n${getOutput()}`)
  }

  const waitForUpdate = async (timeout = 1000): Promise<void> => {
    const initialOutput = getOutput()
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      if (getOutput() !== initialOutput) {
        return
      }
      await delay(50)
    }
    // Don't throw on waitForUpdate - output may not change
  }

  return {
    instance,
    getOutput,
    press,
    type,
    submit,
    tab,
    up,
    down,
    cleanup,
    waitForText,
    waitForUpdate,
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock endpoint URL
 */
export function createMockEndpoint(server: MockRpcServer): string {
  return server.getUrl()
}

/**
 * Assert that output contains specific text patterns
 */
export function assertOutput(output: string, patterns: string[]): void {
  for (const pattern of patterns) {
    if (!output.includes(pattern)) {
      throw new Error(`Expected output to contain "${pattern}"\nActual output:\n${output}`)
    }
  }
}

/**
 * Assert that output does NOT contain specific text
 */
export function assertOutputNotContains(output: string, patterns: string[]): void {
  for (const pattern of patterns) {
    if (output.includes(pattern)) {
      throw new Error(`Expected output NOT to contain "${pattern}"\nActual output:\n${output}`)
    }
  }
}

/**
 * Extract visible text from ANSI-colored output
 * Strips ANSI codes for easier assertion
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return
    }
    await delay(interval)
  }
  throw new Error('waitFor timeout')
}
