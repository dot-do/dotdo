// REPL Tests - TDD for rpc.do CLI REPL with autocomplete
// RED phase: These tests should FAIL initially until implementation is done

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as readline from 'node:readline'
import { EventEmitter } from 'node:events'

// Mock Transport for testing RPC calls
import type { Transport } from '../src/transport/types'
import type { RPCMessage, RPCResponse } from '../src/types'

// Module under test
import { ReplService, type ReplServiceOptions, type ReplCommand } from '../src/cli/repl'

// Sample type definitions for testing (same as lsp.test.ts)
const SAMPLE_TYPES = `
/**
 * ThingsStore - CRUD operations for Things
 */
export interface ThingsStore {
  create<D extends { $type: string }>(data: D): Promise<Thing & D>;
  get(id: string): Promise<Thing | null>;
  update(id: string, data: Partial<any>): Promise<Thing>;
  delete(id: string): Promise<void>;
  list(options?: { type?: string; limit?: number }): Promise<Thing[]>;
}

/**
 * EventsStore - Event emission and query operations
 */
export interface EventsStore {
  emit(event: { type: string; payload?: unknown }): Promise<Event>;
  get(id: string): Promise<Event | null>;
  query(options?: { type?: string }): Promise<Event[]>;
}

export interface Thing {
  $id: string;
  $type: string;
  $createdAt: number;
  $updatedAt: number;
}

export interface Event {
  $id: string;
  type: string;
  $timestamp: number;
  payload: unknown;
}

/**
 * WorkflowContext ($) - Fluent API for events, scheduling, and cross-DO RPC
 */
export interface WorkflowContext {
  things: ThingsStore;
  events: EventsStore;
  on: {
    [noun: string]: {
      [verb: string]: (handler: (event: Event) => void) => void;
    };
  };
  every: {
    [key: string]: any;
  };
  send(event: { type: string; payload?: unknown }): void;
  try<T>(action: () => Promise<T>): Promise<T>;
  do<T>(action: () => Promise<T>): Promise<T>;
  _types(): Promise<string>;
}

declare const $: WorkflowContext;
`

/**
 * Create a mock transport that records calls and returns configured responses
 */
function createMockTransport(responses: Map<string, unknown> = new Map()): Transport & { calls: RPCMessage[] } {
  const calls: RPCMessage[] = []

  return {
    calls,
    async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
      calls.push(message)

      // Check for configured response
      const response = responses.get(message.method)
      if (response !== undefined) {
        return { result: response as T, correlationId: 'test' }
      }

      // Default: return empty result
      return { result: {} as T, correlationId: 'test' }
    },
    async close(): Promise<void> {
      // No-op
    },
  }
}

/**
 * Create a mock readline interface for testing
 */
function createMockReadline(): readline.Interface & { simulateInput: (line: string) => void; simulateClose: () => void } {
  const emitter = new EventEmitter()
  const rl = emitter as unknown as readline.Interface & { simulateInput: (line: string) => void; simulateClose: () => void }

  // Add readline-like methods
  rl.close = () => emitter.emit('close')
  rl.prompt = vi.fn()
  rl.setPrompt = vi.fn()
  rl.question = vi.fn()
  rl.write = vi.fn()

  // Test helpers
  rl.simulateInput = (line: string) => emitter.emit('line', line)
  rl.simulateClose = () => emitter.emit('close')

  return rl
}

// ============================================================================
// ReplService Initialization
// ============================================================================

describe('ReplService initialization', () => {
  it('creates a REPL service with transport and types', () => {
    const transport = createMockTransport()
    const repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
    })

    expect(repl).toBeDefined()
    expect(repl.isRunning()).toBe(false)
  })

  it('creates a REPL service without types (reflection mode)', () => {
    const transport = createMockTransport()
    const repl = new ReplService({
      transport,
    })

    expect(repl).toBeDefined()
  })

  it('supports custom history path', () => {
    const transport = createMockTransport()
    const historyPath = path.join(os.tmpdir(), `repl_history_${Date.now()}.txt`)

    const repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      historyPath,
    })

    expect(repl).toBeDefined()
  })
})

// ============================================================================
// REPL Prompt and Display
// ============================================================================

describe('ReplService prompt', () => {
  let repl: ReplService
  let output: string[]

  beforeEach(() => {
    const transport = createMockTransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('shows prompt when started', async () => {
    // Start REPL (don't wait for it to complete)
    const startPromise = repl.start()

    // Give it time to initialize
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(repl.isRunning()).toBe(true)

    // Stop the REPL
    await repl.stop()
    await startPromise.catch(() => {}) // Ignore any errors from stopping
  })

  it('uses default prompt "$ > "', () => {
    const prompt = repl.getPrompt()
    expect(prompt).toBe('$ > ')
  })

  it('supports custom prompt', () => {
    const transport = createMockTransport()
    const customRepl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      prompt: 'do> ',
    })

    expect(customRepl.getPrompt()).toBe('do> ')
  })
})

// ============================================================================
// Tab Completion
// ============================================================================

describe('ReplService tab completion', () => {
  let repl: ReplService

  beforeEach(() => {
    const transport = createMockTransport()
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('suggests $ methods for "$."', () => {
    const completions = repl.getCompletions('$.', 2)

    expect(completions).toBeDefined()
    expect(completions.length).toBeGreaterThan(0)

    const names = completions.map(c => c.name)
    expect(names).toContain('things')
    expect(names).toContain('events')
    expect(names).toContain('on')
    expect(names).toContain('every')
  })

  it('suggests CRUD methods for "$.things."', () => {
    const completions = repl.getCompletions('$.things.', 9)

    expect(completions).toBeDefined()
    const names = completions.map(c => c.name)
    expect(names).toContain('create')
    expect(names).toContain('get')
    expect(names).toContain('update')
    expect(names).toContain('delete')
    expect(names).toContain('list')
  })

  it('returns readline-compatible completion format', () => {
    const [completions, partial] = repl.complete('$.th')

    expect(Array.isArray(completions)).toBe(true)
    expect(typeof partial).toBe('string')
    // Should have 'things' that matches 'th'
    expect(completions).toContain('things')
    expect(partial).toBe('th')
  })

  it('handles completion at empty string', () => {
    const [completions, partial] = repl.complete('')

    expect(Array.isArray(completions)).toBe(true)
    // Should suggest '$' as a starting point
    expect(partial).toBe('')
  })

  it('handles completion for partial method name "$.things.cr"', () => {
    const [completions, partial] = repl.complete('$.things.cr')

    expect(completions).toContain('create')
    expect(partial).toBe('cr')
  })
})

// ============================================================================
// Command Execution
// ============================================================================

describe('ReplService command execution', () => {
  let repl: ReplService
  let transport: Transport & { calls: RPCMessage[] }
  let output: string[]

  beforeEach(() => {
    transport = createMockTransport(new Map([
      ['things.list', [
        { $id: '1', $type: 'Customer', name: 'Alice' },
        { $id: '2', $type: 'Customer', name: 'Bob' },
      ]],
      ['things.get', { $id: '1', $type: 'Customer', name: 'Alice' }],
    ]))
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('executes "$.things.list()" and sends RPC', async () => {
    await repl.execute('$.things.list()')

    expect(transport.calls.length).toBe(1)
    expect(transport.calls[0]?.method).toBe('things.list')
  })

  it('displays result after execution', async () => {
    await repl.execute('$.things.list()')

    // Output should contain the result
    const outputText = output.join('\n')
    expect(outputText).toContain('Alice')
    expect(outputText).toContain('Bob')
  })

  it('executes "$.things.get(\'id\')" with arguments', async () => {
    await repl.execute('$.things.get("1")')

    expect(transport.calls.length).toBe(1)
    expect(transport.calls[0]?.method).toBe('things.get')
    expect(transport.calls[0]?.args).toEqual(['1'])
  })

  it('handles execution errors gracefully', async () => {
    const errorTransport: Transport = {
      async send<T>(): Promise<RPCResponse<T>> {
        return {
          error: {
            type: 'RPCError',
            code: 'NOT_FOUND',
            message: 'Thing not found',
          },
          correlationId: 'test',
        }
      },
    }

    const errorRepl = new ReplService({
      transport: errorTransport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })

    await errorRepl.execute('$.things.get("nonexistent")')

    // Should output error message
    const outputText = output.join('\n')
    expect(outputText).toMatch(/error|Error|NOT_FOUND/i)
  })

  it('handles local JavaScript evaluation', async () => {
    await repl.execute('const x = 1 + 1')

    // Local evaluation should not send RPC
    expect(transport.calls.length).toBe(0)
  })

  it('pretty-prints result objects', async () => {
    await repl.execute('$.things.list()')

    const outputText = output.join('\n')
    // Should be formatted nicely (with indentation or syntax highlighting)
    expect(outputText).toContain('$id')
    expect(outputText).toContain('$type')
  })
})

// ============================================================================
// Built-in Commands
// ============================================================================

describe('ReplService built-in commands', () => {
  let repl: ReplService
  let output: string[]
  let exitCalled: boolean

  beforeEach(() => {
    const transport = createMockTransport()
    output = []
    exitCalled = false
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
      onExit: () => { exitCalled = true },
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('.exit quits the REPL', async () => {
    await repl.execute('.exit')

    expect(exitCalled).toBe(true)
    expect(repl.isRunning()).toBe(false)
  })

  it('.help shows available commands', async () => {
    await repl.execute('.help')

    const outputText = output.join('\n')
    expect(outputText).toContain('.exit')
    expect(outputText).toContain('.help')
    expect(outputText).toContain('.clear')
  })

  it('.clear clears the screen', async () => {
    let clearCalled = false
    const customRepl = new ReplService({
      transport: createMockTransport(),
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
      onClear: () => { clearCalled = true },
    })

    await customRepl.execute('.clear')

    expect(clearCalled).toBe(true)
  })

  it('.types shows type information', async () => {
    await repl.execute('.types')

    const outputText = output.join('\n')
    // Should show available $ members
    expect(outputText).toContain('things')
    expect(outputText).toContain('events')
  })

  it('unknown command shows error', async () => {
    await repl.execute('.unknown')

    const outputText = output.join('\n')
    expect(outputText).toMatch(/unknown|not recognized|invalid/i)
  })
})

// ============================================================================
// History
// ============================================================================

describe('ReplService history', () => {
  let repl: ReplService
  let historyPath: string

  beforeEach(() => {
    historyPath = path.join(os.tmpdir(), `repl_history_test_${Date.now()}.txt`)
    const transport = createMockTransport()
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      historyPath,
    })
  })

  afterEach(async () => {
    await repl.stop()
    // Clean up history file
    try {
      fs.unlinkSync(historyPath)
    } catch {
      // Ignore
    }
  })

  it('saves command to history', async () => {
    await repl.execute('$.things.list()')

    const history = repl.getHistory()
    expect(history).toContain('$.things.list()')
  })

  it('does not save empty commands to history', async () => {
    await repl.execute('')
    await repl.execute('   ')

    const history = repl.getHistory()
    expect(history.length).toBe(0)
  })

  it('does not save duplicate consecutive commands', async () => {
    await repl.execute('$.things.list()')
    await repl.execute('$.things.list()')

    const history = repl.getHistory()
    expect(history.filter(h => h === '$.things.list()').length).toBe(1)
  })

  it('limits history size', async () => {
    const smallHistoryRepl = new ReplService({
      transport: createMockTransport(),
      types: SAMPLE_TYPES,
      historyPath,
      maxHistorySize: 5,
    })

    for (let i = 0; i < 10; i++) {
      await smallHistoryRepl.execute(`command${i}`)
    }

    const history = smallHistoryRepl.getHistory()
    expect(history.length).toBeLessThanOrEqual(5)
  })

  it('persists history to file', async () => {
    await repl.execute('$.things.list()')
    await repl.execute('$.events.query()')
    await repl.saveHistory()

    // Read history file
    const content = fs.readFileSync(historyPath, 'utf-8')
    expect(content).toContain('$.things.list()')
    expect(content).toContain('$.events.query()')
  })

  it('loads history from file on start', async () => {
    // Write some history
    fs.writeFileSync(historyPath, '$.things.list()\n$.events.query()\n')

    // Create new REPL with same history path
    const newRepl = new ReplService({
      transport: createMockTransport(),
      types: SAMPLE_TYPES,
      historyPath,
    })

    await newRepl.loadHistory()
    const history = newRepl.getHistory()

    expect(history).toContain('$.things.list()')
    expect(history).toContain('$.events.query()')
  })
})

// ============================================================================
// Multiline Input
// ============================================================================

describe('ReplService multiline input', () => {
  let repl: ReplService
  let transport: Transport & { calls: RPCMessage[] }
  let output: string[]

  beforeEach(() => {
    transport = createMockTransport(new Map([
      ['things.create', { $id: 'new-1', $type: 'Customer', name: 'Test' }],
    ]))
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('handles backtick multiline strings', async () => {
    const code = '`line1\nline2\nline3`'
    await repl.execute(code)

    // Should execute successfully
    expect(output.length).toBeGreaterThan(0)
  })

  it('detects incomplete input with open brackets', () => {
    expect(repl.isIncomplete('$.things.create({')).toBe(true)
    expect(repl.isIncomplete('$.things.create({ name: "Test" })')).toBe(false)
  })

  it('detects incomplete input with open parentheses', () => {
    expect(repl.isIncomplete('$.things.get(')).toBe(true)
    expect(repl.isIncomplete('$.things.get("id")')).toBe(false)
  })

  it('detects incomplete input with open backticks', () => {
    expect(repl.isIncomplete('const x = `hello')).toBe(true)
    expect(repl.isIncomplete('const x = `hello`')).toBe(false)
  })

  it('accumulates multiline input until complete', async () => {
    // First line - incomplete
    const line1Result = await repl.processLine('$.things.create({')
    expect(line1Result.complete).toBe(false)

    // Second line - still incomplete
    const line2Result = await repl.processLine('  name: "Test",')
    expect(line2Result.complete).toBe(false)

    // Third line - completes the expression
    const line3Result = await repl.processLine('})')
    expect(line3Result.complete).toBe(true)

    // Should have sent the RPC
    expect(transport.calls.length).toBe(1)
  })
})

// ============================================================================
// Integration with LSPService
// ============================================================================

describe('ReplService LSP integration', () => {
  let repl: ReplService

  beforeEach(() => {
    const transport = createMockTransport()
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('provides hover info for expressions', () => {
    const hover = repl.getHoverInfo('$.things', 3)

    expect(hover).toBeDefined()
    expect(hover?.type).toContain('ThingsStore')
  })

  it('provides signature help for function calls', () => {
    const signature = repl.getSignatureHelp('$.things.create(', 16)

    expect(signature).toBeDefined()
    expect(signature?.signatures.length).toBeGreaterThan(0)
  })

  it('type-checks expressions before execution', () => {
    const errors = repl.checkSyntax('$.things.invalidMethod()')

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message).toMatch(/invalidMethod|does not exist/)
  })
})

// ============================================================================
// Custom Commands Registration
// ============================================================================

describe('ReplService custom commands', () => {
  let repl: ReplService
  let output: string[]

  beforeEach(() => {
    const transport = createMockTransport()
    output = []
    repl = new ReplService({
      transport,
      types: SAMPLE_TYPES,
      output: (text: string) => output.push(text),
    })
  })

  afterEach(async () => {
    await repl.stop()
  })

  it('allows registering custom commands', async () => {
    let customExecuted = false

    repl.registerCommand({
      name: 'custom',
      description: 'A custom test command',
      execute: async () => {
        customExecuted = true
      },
    })

    await repl.execute('.custom')

    expect(customExecuted).toBe(true)
  })

  it('shows custom commands in .help', async () => {
    repl.registerCommand({
      name: 'mycommand',
      description: 'My custom command description',
      execute: async () => {},
    })

    await repl.execute('.help')

    const outputText = output.join('\n')
    expect(outputText).toContain('.mycommand')
    expect(outputText).toContain('My custom command description')
  })

  it('passes arguments to custom commands', async () => {
    let receivedArgs: string[] = []

    repl.registerCommand({
      name: 'echo',
      description: 'Echo arguments',
      execute: async (args) => {
        receivedArgs = args
      },
    })

    await repl.execute('.echo hello world')

    expect(receivedArgs).toEqual(['hello', 'world'])
  })
})
