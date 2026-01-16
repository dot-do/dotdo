/**
 * Test Helpers Unit Tests
 *
 * Verifies that the shared test utilities work correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  createWebSocketMockState,
  createWebSocketMock,
  simulateOpen,
  simulateResponse,
  simulateErrorResponse,
  simulateConnectionDrop,
  simulateError,
  simulateMessage,
  simulateRawMessage,
  simulateCallback,
  simulateEvent,
  simulateLogMessage,
  WS_READY_STATE,
  SAMPLE_DATA,
  createKeyboardContext,
  delay,
  waitFor,
  type MockedWebSocket,
} from './index.js'

import {
  KEYS,
  ctrlKey,
  stripAnsi,
  extractText,
  assertOutput,
  assertOutputNotContains,
  assertOutputMatches,
  countOccurrences,
  getLines,
  getLine,
  findLines,
  hasBorder,
} from './render.js'

// =============================================================================
// WebSocket Mock Tests
// =============================================================================

describe('WebSocket Mock Utilities', () => {
  describe('createWebSocketMockState', () => {
    it('should create state with instances array and helpers', () => {
      const { wsInstances, getMockWs, resetWs } = createWebSocketMockState()

      expect(wsInstances).toEqual([])
      expect(typeof getMockWs).toBe('function')
      expect(typeof resetWs).toBe('function')
    })

    it('should track instances', () => {
      const { wsInstances, getMockWs, resetWs } = createWebSocketMockState()

      // Simulate adding a mock
      const mockWs = {} as MockedWebSocket
      wsInstances.push(mockWs)

      expect(getMockWs()).toBe(mockWs)
      expect(wsInstances.length).toBe(1)

      resetWs()
      expect(wsInstances.length).toBe(0)
    })
  })

  describe('createWebSocketMock', () => {
    it('should create a mock class factory', () => {
      const instances: MockedWebSocket[] = []
      const mock = createWebSocketMock(instances)

      expect(mock.default).toBeDefined()
    })

    it('should create mock WebSocket instances', () => {
      const instances: MockedWebSocket[] = []
      const { default: MockWebSocket } = createWebSocketMock(instances)

      const ws = new MockWebSocket('wss://test.example.com', {
        headers: { Authorization: 'Bearer token' },
      })

      expect(instances.length).toBe(1)
      expect(instances[0].url).toBe('wss://test.example.com')
      expect(instances[0].options?.headers?.Authorization).toBe('Bearer token')
      expect(instances[0].readyState).toBe(WS_READY_STATE.CONNECTING)
    })

    it('should track event handlers', () => {
      const instances: MockedWebSocket[] = []
      const { default: MockWebSocket } = createWebSocketMock(instances)

      const ws = new MockWebSocket('wss://test.example.com') as MockedWebSocket
      const openHandler = vi.fn()
      const messageHandler = vi.fn()

      ws.on('open', openHandler)
      ws.on('message', messageHandler)

      // Trigger events
      ws._triggerEvent('open')
      ws._triggerEvent('message', 'test data')

      expect(openHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledWith('test data')
    })
  })

  describe('WebSocket event simulation helpers', () => {
    let instances: MockedWebSocket[]
    let ws: MockedWebSocket

    beforeEach(() => {
      instances = []
      const { default: MockWebSocket } = createWebSocketMock(instances)
      ws = new MockWebSocket('wss://test.example.com') as MockedWebSocket
    })

    it('simulateOpen should set readyState and trigger open event', () => {
      const openHandler = vi.fn()
      ws.on('open', openHandler)

      simulateOpen(ws)

      expect(ws.readyState).toBe(WS_READY_STATE.OPEN)
      expect(openHandler).toHaveBeenCalled()
    })

    it('simulateResponse should trigger message with response payload', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateResponse(ws, 'msg_123', { success: true })

      expect(messageHandler).toHaveBeenCalled()
      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.id).toBe('msg_123')
      expect(data.type).toBe('response')
      expect(data.result).toEqual({ success: true })
    })

    it('simulateErrorResponse should trigger message with error payload', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateErrorResponse(ws, 'msg_456', { message: 'Not found', code: 'NOT_FOUND' })

      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.id).toBe('msg_456')
      expect(data.type).toBe('response')
      expect(data.error.message).toBe('Not found')
      expect(data.error.code).toBe('NOT_FOUND')
    })

    it('simulateConnectionDrop should close and trigger close event', () => {
      const closeHandler = vi.fn()
      ws.on('close', closeHandler)

      simulateConnectionDrop(ws, 1006, 'Network error')

      expect(ws.readyState).toBe(WS_READY_STATE.CLOSED)
      expect(closeHandler).toHaveBeenCalled()
    })

    it('simulateError should trigger error event', () => {
      const errorHandler = vi.fn()
      ws.on('error', errorHandler)

      const error = new Error('Connection failed')
      simulateError(ws, error)

      expect(errorHandler).toHaveBeenCalledWith(error)
    })

    it('simulateMessage should trigger message with JSON data', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateMessage(ws, { custom: 'data' })

      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.custom).toBe('data')
    })

    it('simulateRawMessage should trigger message with raw string', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateRawMessage(ws, 'raw string data')

      expect(messageHandler).toHaveBeenCalledWith('raw string data')
    })

    it('simulateCallback should trigger callback message', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateCallback(ws, 'cb_001', ['arg1', 'arg2'])

      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.type).toBe('callback')
      expect(data.callbackId).toBe('cb_001')
      expect(data.args).toEqual(['arg1', 'arg2'])
    })

    it('simulateEvent should trigger event message', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateEvent(ws, 'customer.created', { $id: 'cust_001' })

      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.type).toBe('event')
      expect(data.eventType).toBe('customer.created')
      expect(data.data.$id).toBe('cust_001')
    })

    it('simulateLogMessage should trigger log message', () => {
      const messageHandler = vi.fn()
      ws.on('message', messageHandler)

      simulateLogMessage(ws, 'corr_001', 'info', 'Processing...', 0)

      const data = JSON.parse(messageHandler.mock.calls[0][0])
      expect(data.type).toBe('log')
      expect(data.correlationId).toBe('corr_001')
      expect(data.data.level).toBe('info')
      expect(data.data.message).toBe('Processing...')
      expect(data.data.index).toBe(0)
    })
  })
})

// =============================================================================
// Sample Data Tests
// =============================================================================

describe('SAMPLE_DATA Fixtures', () => {
  describe('Schema fixtures', () => {
    it('should have minimal schema', () => {
      expect(SAMPLE_DATA.SCHEMA.MINIMAL).toEqual({
        name: 'Test',
        fields: [],
        methods: [],
      })
    })

    it('should have schema with fields', () => {
      const schema = SAMPLE_DATA.SCHEMA.WITH_FIELDS
      expect(schema.name).toBe('Customer')
      expect(schema.fields.length).toBe(3)
      expect(schema.fields[0].name).toBe('$id')
    })

    it('should have schema with methods', () => {
      const schema = SAMPLE_DATA.SCHEMA.WITH_METHODS
      expect(schema.methods.length).toBe(2)
      expect(schema.methods[0].name).toBe('getOrders')
    })

    it('should have full schema', () => {
      const schema = SAMPLE_DATA.SCHEMA.FULL
      expect(schema.fields.length).toBe(7)
      expect(schema.methods.length).toBe(3)
    })
  })

  describe('Customer fixtures', () => {
    it('should have customer data', () => {
      expect(SAMPLE_DATA.CUSTOMERS.ALICE.$id).toBe('cust_alice_001')
      expect(SAMPLE_DATA.CUSTOMERS.BOB.name).toBe('Bob Smith')
      expect(SAMPLE_DATA.CUSTOMERS.CHARLIE.email).toBe('charlie@example.com')
    })
  })

  describe('Completion fixtures', () => {
    it('should have promise method completions', () => {
      const completions = SAMPLE_DATA.COMPLETIONS.PROMISE_METHODS
      expect(completions.length).toBe(3)
      expect(completions[0].name).toBe('then')
    })
  })

  describe('History fixtures', () => {
    it('should have basic history', () => {
      expect(SAMPLE_DATA.HISTORY.BASIC.length).toBe(3)
    })

    it('should have REPL commands history', () => {
      expect(SAMPLE_DATA.HISTORY.REPL_COMMANDS.length).toBe(4)
    })
  })
})

// =============================================================================
// Keyboard Context Tests
// =============================================================================

describe('createKeyboardContext', () => {
  it('should create default context', () => {
    const ctx = createKeyboardContext()

    expect(ctx.value).toBe('')
    expect(ctx.cursorPosition).toBe(0)
    expect(ctx.history).toEqual([])
    expect(ctx.focused).toBe(true)
    expect(typeof ctx.onChange).toBe('function')
    expect(typeof ctx.onSubmit).toBe('function')
  })

  it('should accept overrides', () => {
    const ctx = createKeyboardContext({
      value: 'test input',
      cursorPosition: 5,
      history: ['cmd1', 'cmd2'],
      focused: false,
    })

    expect(ctx.value).toBe('test input')
    expect(ctx.cursorPosition).toBe(5)
    expect(ctx.history).toEqual(['cmd1', 'cmd2'])
    expect(ctx.focused).toBe(false)
  })

  it('should have mock functions', () => {
    const ctx = createKeyboardContext()

    ctx.onChange('new value')
    ctx.onSubmit('submitted')

    expect(ctx.onChange).toHaveBeenCalledWith('new value')
    expect(ctx.onSubmit).toHaveBeenCalledWith('submitted')
  })
})

// =============================================================================
// Render Helper Tests
// =============================================================================

describe('ANSI and Text Utilities', () => {
  describe('KEYS constants', () => {
    it('should have common key codes', () => {
      expect(KEYS.UP).toBe('\x1B[A')
      expect(KEYS.DOWN).toBe('\x1B[B')
      expect(KEYS.ENTER).toBe('\r')
      expect(KEYS.TAB).toBe('\t')
      expect(KEYS.CTRL_C).toBe('\x03')
    })
  })

  describe('ctrlKey', () => {
    it('should generate ctrl key codes', () => {
      expect(ctrlKey('a')).toBe('\x01')
      expect(ctrlKey('c')).toBe('\x03')
      expect(ctrlKey('d')).toBe('\x04')
      expect(ctrlKey('z')).toBe('\x1A')
    })

    it('should handle uppercase', () => {
      expect(ctrlKey('A')).toBe('\x01')
      expect(ctrlKey('C')).toBe('\x03')
    })
  })

  describe('stripAnsi', () => {
    it('should remove ANSI color codes', () => {
      const colored = '\x1B[32mgreen text\x1B[0m'
      expect(stripAnsi(colored)).toBe('green text')
    })

    it('should handle multiple codes', () => {
      const text = '\x1B[1m\x1B[31mbold red\x1B[0m normal \x1B[34mblue\x1B[0m'
      expect(stripAnsi(text)).toBe('bold red normal blue')
    })

    it('should return plain text unchanged', () => {
      expect(stripAnsi('plain text')).toBe('plain text')
    })
  })

  describe('extractText', () => {
    it('should strip ANSI and normalize whitespace', () => {
      const text = '  \x1B[32mhello\x1B[0m   world  '
      expect(extractText(text)).toBe('hello world')
    })
  })
})

describe('Output Assertion Helpers', () => {
  describe('assertOutput', () => {
    it('should pass when patterns are found', () => {
      expect(() => {
        assertOutput('hello world', ['hello', 'world'])
      }).not.toThrow()
    })

    it('should throw when pattern is missing', () => {
      expect(() => {
        assertOutput('hello world', ['goodbye'])
      }).toThrow('Expected output to contain "goodbye"')
    })

    it('should strip ANSI codes', () => {
      expect(() => {
        assertOutput('\x1B[32mhello\x1B[0m world', ['hello'])
      }).not.toThrow()
    })
  })

  describe('assertOutputNotContains', () => {
    it('should pass when patterns are NOT found', () => {
      expect(() => {
        assertOutputNotContains('hello world', ['goodbye', 'foo'])
      }).not.toThrow()
    })

    it('should throw when pattern is found', () => {
      expect(() => {
        assertOutputNotContains('hello world', ['hello'])
      }).toThrow('Expected output NOT to contain "hello"')
    })
  })

  describe('assertOutputMatches', () => {
    it('should pass when regex matches', () => {
      expect(() => {
        assertOutputMatches('hello world 123', /\d+/)
      }).not.toThrow()
    })

    it('should throw when regex does not match', () => {
      expect(() => {
        assertOutputMatches('hello world', /\d+/)
      }).toThrow()
    })
  })

  describe('countOccurrences', () => {
    it('should count pattern occurrences', () => {
      expect(countOccurrences('hello hello hello', 'hello')).toBe(3)
      expect(countOccurrences('hello world', 'hello')).toBe(1)
      expect(countOccurrences('hello world', 'foo')).toBe(0)
    })
  })
})

describe('Line Analysis Helpers', () => {
  const multilineOutput = 'line one\nline two\nline three'

  describe('getLines', () => {
    it('should split into lines', () => {
      const lines = getLines(multilineOutput)
      expect(lines).toEqual(['line one', 'line two', 'line three'])
    })
  })

  describe('getLine', () => {
    it('should get specific line (1-indexed)', () => {
      expect(getLine(multilineOutput, 1)).toBe('line one')
      expect(getLine(multilineOutput, 2)).toBe('line two')
      expect(getLine(multilineOutput, 3)).toBe('line three')
    })

    it('should return undefined for out of range', () => {
      expect(getLine(multilineOutput, 10)).toBeUndefined()
    })
  })

  describe('findLines', () => {
    it('should find lines containing pattern', () => {
      const lines = findLines('apple\nbanana\napricot', 'ap')
      expect(lines).toEqual(['apple', 'apricot'])
    })
  })

  describe('hasBorder', () => {
    it('should detect border characters', () => {
      expect(hasBorder('\u250C\u2500\u2510')).toBe(true)
      expect(hasBorder('plain text')).toBe(false)
    })
  })
})

// =============================================================================
// Timing Utility Tests
// =============================================================================

describe('Timing Utilities', () => {
  describe('delay', () => {
    it('should delay for specified time', async () => {
      const start = Date.now()
      await delay(50)
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(40) // Allow some tolerance
    })
  })

  describe('waitFor', () => {
    it('should resolve when condition becomes true', async () => {
      let ready = false
      setTimeout(() => {
        ready = true
      }, 50)

      await expect(waitFor(() => ready, 1000)).resolves.toBeUndefined()
    })

    it('should throw on timeout', async () => {
      await expect(waitFor(() => false, 100)).rejects.toThrow('waitFor timeout')
    })
  })
})
