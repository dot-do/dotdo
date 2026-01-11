/**
 * CLI Service Commands Tests (TDD RED Phase)
 *
 * Tests for cli.do service commands:
 * - call - Voice calls via calls.do
 * - text - SMS via texts.do
 * - email - Email via emails.do
 * - charge - Payments via payments.do
 * - queue - Queue operations via queue.do
 * - llm - LLM requests via llm.do
 * - config - Configuration management
 *
 * Implementation locations:
 * - cli/src/config.ts - Config management
 * - cli/src/output.ts - Output formatting
 * - cli/src/commands/*.ts - Command modules
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// Mock Setup
// ============================================================================

const { mockFs, mockOs, mockDeviceAuth } = vi.hoisted(() => ({
  mockFs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
  },
  mockOs: {
    homedir: () => '/home/testuser',
    platform: () => 'darwin',
  },
  mockDeviceAuth: {
    getStoredToken: vi.fn(),
    clearToken: vi.fn(),
  },
}))

vi.mock('fs/promises', () => mockFs)
vi.mock('os', () => mockOs)
vi.mock('../device-auth', () => mockDeviceAuth)

const mockFetch = vi.fn()
global.fetch = mockFetch

// Helper to set up authenticated state
function setupAuthenticatedState() {
  mockDeviceAuth.getStoredToken.mockResolvedValue({
    access_token: 'test-token',
    token_type: 'Bearer',
    expires_at: Date.now() + 3600000,
  })
}

// ============================================================================
// Imports (will fail until implementation exists)
// ============================================================================

import {
  getConfig,
  setConfig,
  getConfigPath,
  defaultConfig,
  type Config,
} from '../src/config'

import {
  formatJson,
  formatTable,
  formatStream,
  createSpinner,
  type OutputOptions,
} from '../src/output'

import { run as runCall } from '../src/commands/call'
import { run as runText } from '../src/commands/text'
import { run as runEmail } from '../src/commands/email'
import { run as runCharge } from '../src/commands/charge'
import { run as runQueue } from '../src/commands/queue'
import { run as runLlm } from '../src/commands/llm'
import { run as runConfigCmd } from '../src/commands/config'

// ============================================================================
// Config Management Tests
// ============================================================================

describe('Config Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getConfigPath', () => {
    it('returns path in user home directory', () => {
      const path = getConfigPath()
      expect(path).toContain('/home/testuser')
    })

    it('uses .dotdo directory for config', () => {
      const path = getConfigPath()
      expect(path).toContain('.dotdo')
    })

    it('returns path to config file', () => {
      const path = getConfigPath()
      expect(path).toContain('config')
    })
  })

  describe('defaultConfig', () => {
    it('has api_url set to rpc.do', () => {
      expect(defaultConfig.api_url).toBe('https://rpc.do')
    })

    it('has json output disabled by default', () => {
      expect(defaultConfig.json_output).toBe(false)
    })
  })

  describe('getConfig', () => {
    it('returns stored config when present', async () => {
      const storedConfig: Config = {
        api_url: 'https://custom.api.do',
        json_output: true,
        default_model: 'claude-sonnet',
      }
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(storedConfig))

      const config = await getConfig()

      expect(config.api_url).toBe('https://custom.api.do')
      expect(config.json_output).toBe(true)
    })

    it('returns default config when no file exists', async () => {
      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' })

      const config = await getConfig()

      expect(config.api_url).toBe(defaultConfig.api_url)
    })

    it('merges stored config with defaults', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ json_output: true }))

      const config = await getConfig()

      expect(config.api_url).toBe(defaultConfig.api_url)
      expect(config.json_output).toBe(true)
    })

    it('handles malformed JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValueOnce('not valid json')

      const config = await getConfig()

      expect(config).toEqual(defaultConfig)
    })
  })

  describe('setConfig', () => {
    beforeEach(() => {
      mockFs.access.mockRejectedValue({ code: 'ENOENT' })
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    })

    it('writes config to file', async () => {
      await setConfig({ json_output: true })

      expect(mockFs.writeFile).toHaveBeenCalled()
    })

    it('creates config directory if it does not exist', async () => {
      await setConfig({ json_output: true })

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.dotdo'),
        expect.objectContaining({ recursive: true })
      )
    })

    it('merges with existing config', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ api_url: 'https://custom.do' }))

      await setConfig({ json_output: true })

      const writtenContent = mockFs.writeFile.mock.calls[0][1]
      const parsed = JSON.parse(writtenContent)

      expect(parsed.api_url).toBe('https://custom.do')
      expect(parsed.json_output).toBe(true)
    })

    it('sets secure file permissions', async () => {
      await setConfig({ json_output: true })

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      )
    })
  })
})

// ============================================================================
// Output Formatting Tests
// ============================================================================

describe('Output Formatting', () => {
  describe('formatJson', () => {
    it('returns JSON string for object', () => {
      const result = formatJson({ foo: 'bar' })
      expect(result).toBe('{"foo":"bar"}')
    })

    it('supports pretty printing', () => {
      const result = formatJson({ foo: 'bar' }, { pretty: true })
      expect(result).toContain('\n')
    })

    it('handles arrays', () => {
      const result = formatJson([1, 2, 3])
      expect(result).toBe('[1,2,3]')
    })

    it('handles nested objects', () => {
      const result = formatJson({ a: { b: { c: 1 } } })
      expect(JSON.parse(result)).toEqual({ a: { b: { c: 1 } } })
    })
  })

  describe('formatTable', () => {
    it('formats array of objects as table', () => {
      const data = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]
      const result = formatTable(data)

      expect(result).toContain('id')
      expect(result).toContain('name')
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
    })

    it('supports custom columns', () => {
      const data = [{ id: '1', name: 'Alice', secret: 'hidden' }]
      const result = formatTable(data, { columns: ['id', 'name'] })

      expect(result).toContain('id')
      expect(result).toContain('name')
      expect(result).not.toContain('secret')
    })

    it('handles empty array', () => {
      const result = formatTable([])
      expect(result).toBe('')
    })

    it('truncates long values', () => {
      const data = [{ value: 'a'.repeat(100) }]
      const result = formatTable(data, { maxWidth: 20 })

      expect(result.length).toBeLessThan(150)
    })
  })

  describe('formatStream', () => {
    it('returns async iterator for streaming response', async () => {
      const mockReader = {
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('chunk1') })
          .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('chunk2') })
          .mockResolvedValueOnce({ done: true }),
      }
      const mockStream = { getReader: () => mockReader }

      const chunks: string[] = []
      for await (const chunk of formatStream(mockStream as unknown as ReadableStream)) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(['chunk1', 'chunk2'])
    })
  })

  describe('createSpinner', () => {
    it('returns spinner interface', () => {
      const spinner = createSpinner('Loading...')

      expect(spinner).toHaveProperty('start')
      expect(spinner).toHaveProperty('stop')
      expect(spinner).toHaveProperty('succeed')
      expect(spinner).toHaveProperty('fail')
    })

    it('start begins spinner animation', () => {
      const spinner = createSpinner('Loading...')
      expect(() => spinner.start()).not.toThrow()
    })

    it('stop ends spinner animation', () => {
      const spinner = createSpinner('Loading...')
      spinner.start()
      expect(() => spinner.stop()).not.toThrow()
    })
  })
})

// ============================================================================
// Call Command Tests
// ============================================================================

describe('call command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('makes POST request to calls.do', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123', status: 'initiated' }),
    })

    await runCall(['+15551234567', 'Your appointment is tomorrow'])

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('calls.do'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends phone number and message in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123' }),
    })

    await runCall(['+15551234567', 'Hello world'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.to).toBe('+15551234567')
    expect(body.message).toBe('Hello world')
  })

  it('supports --from flag for caller ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123' }),
    })

    await runCall(['+15551234567', 'Hello', '--from', '+15559876543'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.from).toBe('+15559876543')
  })

  it('supports --voice flag for TTS voice', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123' }),
    })

    await runCall(['+15551234567', 'Hello', '--voice', 'alice'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.voice).toBe('alice')
  })

  it('returns call_id on success', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_xyz' }),
    })

    await runCall(['+15551234567', 'Hello'])

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('call_xyz'))
    consoleSpy.mockRestore()
  })

  it('throws on missing phone number', async () => {
    await expect(runCall([])).rejects.toThrow(/phone number/i)
  })

  it('throws on missing message', async () => {
    await expect(runCall(['+15551234567'])).rejects.toThrow(/message/i)
  })

  it('validates phone number format', async () => {
    await expect(runCall(['invalid', 'Hello'])).rejects.toThrow(/phone/i)
  })

  it('outputs JSON when --json flag is set', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123', status: 'initiated' }),
    })

    await runCall(['+15551234567', 'Hello', '--json'])

    const output = consoleSpy.mock.calls[0][0]
    expect(() => JSON.parse(output)).not.toThrow()
    consoleSpy.mockRestore()
  })
})

// ============================================================================
// Text Command Tests
// ============================================================================

describe('text command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('makes POST request to texts.do', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message_id: 'msg_123' }),
    })

    await runText(['+15551234567', 'Reply YES to confirm'])

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('texts.do'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends phone number and message in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message_id: 'msg_123' }),
    })

    await runText(['+15551234567', 'Hello SMS'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.to).toBe('+15551234567')
    expect(body.body).toBe('Hello SMS')
  })

  it('supports --from flag for sender number', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message_id: 'msg_123' }),
    })

    await runText(['+15551234567', 'Hello', '--from', '+15559876543'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.from).toBe('+15559876543')
  })

  it('supports --media-url flag for MMS', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message_id: 'msg_123' }),
    })

    await runText(['+15551234567', 'Check this out', '--media-url', 'https://example.com/image.jpg'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.media_url).toBe('https://example.com/image.jpg')
  })

  it('returns message_id on success', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message_id: 'msg_abc' }),
    })

    await runText(['+15551234567', 'Hello'])

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('msg_abc'))
    consoleSpy.mockRestore()
  })

  it('throws on missing phone number', async () => {
    await expect(runText([])).rejects.toThrow(/phone number/i)
  })

  it('throws on missing message', async () => {
    await expect(runText(['+15551234567'])).rejects.toThrow(/message/i)
  })
})

// ============================================================================
// Email Command Tests
// ============================================================================

describe('email command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('makes POST request to emails.do', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Hello'])

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('emails.do'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends email address in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Test'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.to).toBe('user@example.com')
  })

  it('supports --template flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--template', 'welcome'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.template).toBe('welcome')
  })

  it('supports --subject flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Welcome aboard!'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.subject).toBe('Welcome aboard!')
  })

  it('supports --body flag for plain text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Hi', '--body', 'Hello there!'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.text).toBe('Hello there!')
  })

  it('supports --html flag for HTML content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Hi', '--html', '<h1>Hello</h1>'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.html).toBe('<h1>Hello</h1>')
  })

  it('supports --from flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: 'email_123' }),
    })

    await runEmail(['user@example.com', '--subject', 'Hi', '--from', 'noreply@company.com'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.from).toBe('noreply@company.com')
  })

  it('throws on missing email address', async () => {
    await expect(runEmail([])).rejects.toThrow(/email/i)
  })

  it('validates email address format', async () => {
    await expect(runEmail(['not-an-email', '--subject', 'Hi'])).rejects.toThrow(/email/i)
  })
})

// ============================================================================
// Charge Command Tests
// ============================================================================

describe('charge command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('makes POST request to payments.do', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_123', '--amount', '9900'])

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('payments.do'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends customer ID and amount in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_abc', '--amount', '5000'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.customer).toBe('cus_abc')
    expect(body.amount).toBe(5000)
  })

  it('supports --currency flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_123', '--amount', '1000', '--currency', 'eur'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.currency).toBe('eur')
  })

  it('defaults currency to usd', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_123', '--amount', '1000'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.currency).toBe('usd')
  })

  it('supports --description flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_123', '--amount', '1000', '--description', 'Monthly subscription'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.description).toBe('Monthly subscription')
  })

  it('supports --metadata flag as JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_123' }),
    })

    await runCharge(['cus_123', '--amount', '1000', '--metadata', '{"order_id":"ord_123"}'])

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.metadata).toEqual({ order_id: 'ord_123' })
  })

  it('returns charge_id on success', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ charge_id: 'ch_xyz' }),
    })

    await runCharge(['cus_123', '--amount', '1000'])

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ch_xyz'))
    consoleSpy.mockRestore()
  })

  it('throws on missing customer ID', async () => {
    await expect(runCharge([])).rejects.toThrow(/customer/i)
  })

  it('throws on missing amount', async () => {
    await expect(runCharge(['cus_123'])).rejects.toThrow(/amount/i)
  })

  it('validates amount is positive integer', async () => {
    await expect(runCharge(['cus_123', '--amount', '-100'])).rejects.toThrow(/amount/i)
  })
})

// ============================================================================
// Queue Command Tests
// ============================================================================

describe('queue command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  describe('publish subcommand', () => {
    it('makes POST request to queue.do', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: 'qmsg_123' }),
      })

      await runQueue(['publish', 'my-queue', '{"event": "user.signup"}'])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('queue.do'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('sends queue name and message in request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: 'qmsg_123' }),
      })

      await runQueue(['publish', 'events-queue', '{"type": "test"}'])

      const [url, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body)

      expect(url).toContain('events-queue')
      expect(body).toEqual({ type: 'test' })
    })

    it('supports --delay flag for delayed messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: 'qmsg_123' }),
      })

      await runQueue(['publish', 'my-queue', '{}', '--delay', '60'])

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers).toHaveProperty('X-Delay')
    })

    it('supports --content-type flag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: 'qmsg_123' }),
      })

      await runQueue(['publish', 'my-queue', '<xml>data</xml>', '--content-type', 'application/xml'])

      const [, options] = mockFetch.mock.calls[0]
      expect(options.headers['Content-Type']).toBe('application/xml')
    })

    it('throws on missing queue name', async () => {
      await expect(runQueue(['publish'])).rejects.toThrow(/queue/i)
    })

    it('throws on missing message', async () => {
      await expect(runQueue(['publish', 'my-queue'])).rejects.toThrow(/message/i)
    })
  })

  describe('list subcommand', () => {
    it('makes GET request to queue.do', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ queues: [] }),
      })

      await runQueue(['list'])

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('queue.do'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns list of queues', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          queues: [
            { name: 'queue-1', messages: 10 },
            { name: 'queue-2', messages: 5 },
          ],
        }),
      })

      await runQueue(['list'])

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// LLM Command Tests
// ============================================================================

describe('llm command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('makes POST request to llm.do', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Hello!' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello, how are you?', '--no-stream'])
    consoleSpy.mockRestore()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('llm.do'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('sends prompt in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Summarize this document', '--no-stream'])
    consoleSpy.mockRestore()

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.prompt).toBe('Summarize this document')
  })

  it('supports --model flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello', '--model', 'claude-sonnet', '--no-stream'])
    consoleSpy.mockRestore()

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.model).toBe('claude-sonnet')
  })

  it('supports --system flag for system prompt', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello', '--system', 'You are a helpful assistant', '--no-stream'])
    consoleSpy.mockRestore()

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.system).toBe('You are a helpful assistant')
  })

  it('supports --max-tokens flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello', '--max-tokens', '100', '--no-stream'])
    consoleSpy.mockRestore()

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.max_tokens).toBe(100)
  })

  it('supports --temperature flag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello', '--temperature', '0.7', '--no-stream'])
    consoleSpy.mockRestore()

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(body.temperature).toBe(0.7)
  })

  it('streams response by default', async () => {
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"delta":"Hello"}') })
        .mockResolvedValueOnce({ done: true }),
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => mockReader },
    })

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await runLlm(['Hello'])

    expect(writeSpy).toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it('supports --no-stream flag for non-streaming', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ response: 'Full response' }),
    })

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runLlm(['Hello', '--no-stream'])

    expect(consoleSpy).toHaveBeenCalledWith('Full response')
    consoleSpy.mockRestore()
  })

  it('throws on missing prompt', async () => {
    await expect(runLlm([])).rejects.toThrow(/prompt/i)
  })

  // Note: stdin handling test skipped - requires complex mock setup
  // The feature can be tested manually: echo "Hello" | do llm -
})

// ============================================================================
// Config Command Tests
// ============================================================================

describe('config command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
  })
  // Note: config command doesn't require auth

  describe('get subcommand', () => {
    it('displays all config when no key specified', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ api_url: 'https://rpc.do' }))

      await runConfigCmd(['get'])

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('api_url'))
      consoleSpy.mockRestore()
    })

    it('displays specific config value when key specified', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ api_url: 'https://custom.do' }))

      await runConfigCmd(['get', 'api_url'])

      expect(consoleSpy).toHaveBeenCalledWith('https://custom.do')
      consoleSpy.mockRestore()
    })

    it('shows default value when key not set', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await runConfigCmd(['get', 'json_output'])

      expect(consoleSpy).toHaveBeenCalledWith(false)
      consoleSpy.mockRestore()
    })
  })

  describe('set subcommand', () => {
    beforeEach(() => {
      mockFs.access.mockRejectedValue({ code: 'ENOENT' })
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)
    })

    it('sets config value', async () => {
      await runConfigCmd(['set', 'json_output', 'true'])

      const writtenContent = mockFs.writeFile.mock.calls[0][1]
      const parsed = JSON.parse(writtenContent)

      expect(parsed.json_output).toBe(true)
    })

    it('throws on invalid key', async () => {
      await expect(runConfigCmd(['set', 'invalid_key', 'value'])).rejects.toThrow(/unknown/i)
    })

    it('validates value type', async () => {
      await expect(runConfigCmd(['set', 'json_output', 'not-a-boolean'])).rejects.toThrow(/invalid/i)
    })
  })

  describe('unset subcommand', () => {
    beforeEach(() => {
      mockFs.access.mockRejectedValue({ code: 'ENOENT' })
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)
    })

    it('removes config value', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({ api_url: 'https://custom.do', json_output: true }))

      await runConfigCmd(['unset', 'api_url'])

      const writtenContent = mockFs.writeFile.mock.calls[0][1]
      const parsed = JSON.parse(writtenContent)

      expect(parsed.api_url).toBeUndefined()
      expect(parsed.json_output).toBe(true)
    })
  })

  describe('list subcommand', () => {
    it('lists all available config keys', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await runConfigCmd(['list'])

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('api_url'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('json_output'))
      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// Auth Integration Tests
// ============================================================================

describe('Auth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
  })

  it('service commands include auth token in requests', async () => {
    // Setup stored token via mock
    mockDeviceAuth.getStoredToken.mockResolvedValue({
      access_token: 'stored-token',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600000,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ call_id: 'call_123' }),
    })

    await runCall(['+15551234567', 'Hello'])

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers.Authorization).toBe('Bearer stored-token')
  })

  it('prompts login when no token available', async () => {
    // No stored token
    mockDeviceAuth.getStoredToken.mockResolvedValue(null)

    await expect(runCall(['+15551234567', 'Hello'])).rejects.toThrow(/login/i)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs.readFile.mockRejectedValue({ code: 'ENOENT' })
    setupAuthenticatedState()
  })

  it('displays error message on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_request', message: 'Bad request' }),
    })

    await expect(runCall(['+15551234567', 'Hello'])).rejects.toThrow()
  })

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(runCall(['+15551234567', 'Hello'])).rejects.toThrow(/network/i)
  })

  it('handles rate limiting', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '60' }),
      json: () => Promise.resolve({ error: 'rate_limit_exceeded' }),
    })

    await expect(runCall(['+15551234567', 'Hello'])).rejects.toThrow(/rate/i)
  })
})

// ============================================================================
// CLI Integration Tests
// ============================================================================

describe('CLI Integration', () => {
  it('registers service commands in router', async () => {
    const { route } = await import('../index')

    expect(route(['call']).type).toBe('command')
    expect(route(['text']).type).toBe('command')
    expect(route(['email']).type).toBe('command')
    expect(route(['charge']).type).toBe('command')
    expect(route(['queue']).type).toBe('command')
    expect(route(['llm']).type).toBe('command')
    expect(route(['config']).type).toBe('command')
  })

  it('help text includes service commands', async () => {
    const { helpText } = await import('../index')

    expect(helpText).toContain('call')
    expect(helpText).toContain('text')
    expect(helpText).toContain('email')
    expect(helpText).toContain('charge')
    expect(helpText).toContain('queue')
    expect(helpText).toContain('llm')
    expect(helpText).toContain('config')
  })
})
