/**
 * Terminal Renderer Tests
 *
 * Comprehensive tests for multi-tier rendering (text, markdown, ANSI)
 */

import { describe, it, expect } from 'vitest'
import {
  renderBadge,
  renderProgress,
  renderSpinner,
  renderPanel,
  renderTable,
  detectTier,
  detectCapabilities,
  TerminalRenderer,
  stripAnsi,
  visibleLength,
  pad,
  truncate,
  wordWrap,
  type RenderTier,
  type BadgeVariant,
} from '../../src/do/terminal-renderer.js'

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  describe('stripAnsi', () => {
    it('should remove ANSI escape codes', () => {
      expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
      expect(stripAnsi('\x1b[1m\x1b[32mbold green\x1b[0m')).toBe('bold green')
      expect(stripAnsi('plain text')).toBe('plain text')
    })

    it('should handle multiple ANSI codes', () => {
      const styled = '\x1b[1m\x1b[4m\x1b[36munderlined bold cyan\x1b[0m'
      expect(stripAnsi(styled)).toBe('underlined bold cyan')
    })
  })

  describe('visibleLength', () => {
    it('should return correct length without ANSI codes', () => {
      expect(visibleLength('\x1b[31mred\x1b[0m')).toBe(3)
      expect(visibleLength('hello')).toBe(5)
      expect(visibleLength('\x1b[1m\x1b[32mbold\x1b[0m')).toBe(4)
    })
  })

  describe('pad', () => {
    it('should pad strings to left by default', () => {
      expect(pad('hi', 5)).toBe('hi   ')
      expect(pad('hello', 3)).toBe('hello')
    })

    it('should pad strings to right', () => {
      expect(pad('hi', 5, 'right')).toBe('   hi')
    })

    it('should center strings', () => {
      expect(pad('hi', 6, 'center')).toBe('  hi  ')
      expect(pad('hi', 5, 'center')).toBe(' hi  ')
    })
  })

  describe('truncate', () => {
    it('should truncate long strings', () => {
      expect(truncate('hello world', 8)).toBe('hello w\u2026')
      expect(truncate('short', 10)).toBe('short')
    })

    it('should use custom ellipsis', () => {
      expect(truncate('hello world', 8, '...')).toBe('hello...')
    })
  })

  describe('wordWrap', () => {
    it('should wrap text at word boundaries', () => {
      const result = wordWrap('hello world foo bar', 10)
      expect(result).toEqual(['hello', 'world foo', 'bar'])
    })

    it('should handle single words longer than max width', () => {
      const result = wordWrap('superlongword short', 5)
      expect(result).toEqual(['superlongword', 'short'])
    })

    it('should handle empty strings', () => {
      expect(wordWrap('', 10)).toEqual([])
    })
  })
})

// ============================================================================
// BADGE RENDERER TESTS
// ============================================================================

describe('renderBadge', () => {
  describe('text tier', () => {
    it('should render simple bracketed text', () => {
      expect(renderBadge('OK', 'default', { tier: 'text' })).toBe('[OK]')
      expect(renderBadge('ERROR', 'error', { tier: 'text' })).toBe('[ERROR]')
    })
  })

  describe('markdown tier', () => {
    it('should render as inline code', () => {
      expect(renderBadge('OK', 'default', { tier: 'markdown' })).toBe('`OK`')
    })

    it('should add prefix for variants', () => {
      expect(renderBadge('test', 'success', { tier: 'markdown' })).toBe('`[OK] test`')
      expect(renderBadge('test', 'warning', { tier: 'markdown' })).toBe('`[WARN] test`')
      expect(renderBadge('test', 'error', { tier: 'markdown' })).toBe('`[ERROR] test`')
      expect(renderBadge('test', 'info', { tier: 'markdown' })).toBe('`[INFO] test`')
    })
  })

  describe('ansi tier', () => {
    it('should render with ANSI color codes', () => {
      const result = renderBadge('OK', 'success', { tier: 'ansi' })
      expect(result).toContain('\x1b[')
      expect(stripAnsi(result)).toBe(' OK ')
    })

    it('should use different colors for variants', () => {
      const success = renderBadge('OK', 'success', { tier: 'ansi' })
      const error = renderBadge('ERR', 'error', { tier: 'ansi' })
      expect(success).not.toBe(error)
      expect(success).toContain('\x1b[42m') // green background
      expect(error).toContain('\x1b[41m') // red background
    })
  })
})

// ============================================================================
// PROGRESS RENDERER TESTS
// ============================================================================

describe('renderProgress', () => {
  describe('text tier', () => {
    it('should render ASCII progress bar', () => {
      const result = renderProgress(50, undefined, { tier: 'text' })
      expect(result).toMatch(/\[#{10}-{10}\] 50%/)
    })

    it('should handle 0% and 100%', () => {
      const zero = renderProgress(0, undefined, { tier: 'text' })
      expect(zero).toMatch(/\[-{20}\] 0%/)

      const full = renderProgress(100, undefined, { tier: 'text' })
      expect(full).toMatch(/\[#{20}\] 100%/)
    })

    it('should include label when provided', () => {
      const result = renderProgress(75, 'Loading', { tier: 'text' })
      expect(result).toContain('Loading')
    })

    it('should clamp values outside 0-100', () => {
      const over = renderProgress(150, undefined, { tier: 'text' })
      expect(over).toContain('100%')

      const under = renderProgress(-10, undefined, { tier: 'text' })
      expect(under).toContain('0%')
    })
  })

  describe('markdown tier', () => {
    it('should render progress with code formatting', () => {
      const result = renderProgress(50, 'Building', { tier: 'markdown' })
      expect(result).toContain('**Building**')
      expect(result).toContain('`[')
      expect(result).toContain('50%')
    })
  })

  describe('ansi tier', () => {
    it('should render with ANSI color codes', () => {
      const result = renderProgress(50, undefined, { tier: 'ansi' })
      expect(result).toContain('\x1b[')
      expect(result).toContain('50%')
    })
  })

  describe('options', () => {
    it('should respect barWidth option', () => {
      const result = renderProgress(50, undefined, { tier: 'text', barWidth: 10 })
      expect(result).toMatch(/\[#{5}-{5}\]/)
    })

    it('should hide percentage when showPercentage is false', () => {
      const result = renderProgress(50, undefined, { tier: 'text', showPercentage: false })
      expect(result).not.toContain('%')
    })
  })
})

// ============================================================================
// SPINNER RENDERER TESTS
// ============================================================================

describe('renderSpinner', () => {
  describe('text tier', () => {
    it('should render ASCII spinner frames', () => {
      const frame0 = renderSpinner(undefined, { tier: 'text', frame: 0 })
      const frame1 = renderSpinner(undefined, { tier: 'text', frame: 1 })
      expect(frame0).toBe('|')
      expect(frame1).toBe('/')
    })

    it('should include label', () => {
      const result = renderSpinner('Loading', { tier: 'text', frame: 0 })
      expect(result).toBe('| Loading')
    })
  })

  describe('ansi tier', () => {
    it('should render unicode spinner with color', () => {
      const result = renderSpinner('Working', { tier: 'ansi', frame: 0 })
      expect(result).toContain('\x1b[')
      expect(stripAnsi(result)).toContain('Working')
    })
  })

  describe('markdown tier', () => {
    it('should render unicode spinner', () => {
      const result = renderSpinner('Processing', { tier: 'markdown', frame: 0 })
      expect(result).toContain('Processing')
    })
  })
})

// ============================================================================
// PANEL RENDERER TESTS
// ============================================================================

describe('renderPanel', () => {
  describe('text tier', () => {
    it('should render ASCII bordered panel', () => {
      const result = renderPanel('Title', 'Content', { tier: 'text', width: 30 })
      expect(result).toContain('+')
      expect(result).toContain('-')
      expect(result).toContain('|')
      expect(result).toContain('Title')
      expect(result).toContain('Content')
    })
  })

  describe('markdown tier', () => {
    it('should render as blockquote with heading', () => {
      const result = renderPanel('Title', 'Content', { tier: 'markdown' })
      expect(result).toContain('### Title')
      expect(result).toContain('> Content')
    })

    it('should work without title', () => {
      const result = renderPanel('', 'Just content', { tier: 'markdown' })
      expect(result).not.toContain('###')
      expect(result).toContain('> Just content')
    })
  })

  describe('ansi tier', () => {
    it('should render with ANSI color codes and unicode borders', () => {
      const result = renderPanel('Info', 'Details here', { tier: 'ansi', width: 40 })
      expect(result).toContain('\x1b[')
      expect(stripAnsi(result)).toContain('Info')
      expect(stripAnsi(result)).toContain('Details here')
      // Check for unicode box characters
      expect(result).toMatch(/[\u2500-\u257f]/)
    })
  })
})

// ============================================================================
// TABLE RENDERER TESTS
// ============================================================================

describe('renderTable', () => {
  const sampleData = [
    { name: 'Alice', age: 30, city: 'NYC' },
    { name: 'Bob', age: 25, city: 'LA' },
    { name: 'Charlie', age: 35, city: 'Chicago' },
  ]

  describe('text tier', () => {
    it('should render aligned columns', () => {
      const result = renderTable(sampleData, { tier: 'text' })
      expect(result).toContain('name')
      expect(result).toContain('age')
      expect(result).toContain('city')
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
    })

    it('should handle empty data', () => {
      const result = renderTable([], { tier: 'text' })
      expect(result).toBe('(no data)')
    })

    it('should respect maxRows option', () => {
      const result = renderTable(sampleData, { tier: 'text', maxRows: 2 })
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
      expect(result).not.toContain('Charlie')
      expect(result).toContain('and 1 more row')
    })
  })

  describe('markdown tier', () => {
    it('should render as markdown table', () => {
      const result = renderTable(sampleData, { tier: 'markdown' })
      expect(result).toContain('| name |')
      expect(result).toContain('| --- |')
      expect(result).toContain('| Alice |')
    })

    it('should handle empty data', () => {
      const result = renderTable([], { tier: 'markdown' })
      expect(result).toBe('_No data_')
    })

    it('should escape pipe characters in data', () => {
      const dataWithPipe = [{ value: 'a|b' }]
      const result = renderTable(dataWithPipe, { tier: 'markdown' })
      expect(result).toContain('a\\|b')
    })

    it('should support column alignment', () => {
      const result = renderTable(sampleData, {
        tier: 'markdown',
        columns: [
          { header: 'Name', key: 'name', align: 'left' },
          { header: 'Age', key: 'age', align: 'right' },
          { header: 'City', key: 'city', align: 'center' },
        ],
      })
      expect(result).toContain('| --- |')
      expect(result).toContain('| ---: |')
      expect(result).toContain('| :---: |')
    })
  })

  describe('ansi tier', () => {
    it('should render with borders and colors', () => {
      const result = renderTable(sampleData, { tier: 'ansi' })
      expect(result).toContain('\x1b[')
      expect(stripAnsi(result)).toContain('name')
      expect(stripAnsi(result)).toContain('Alice')
    })

    it('should show truncation notice', () => {
      const result = renderTable(sampleData, { tier: 'ansi', maxRows: 1 })
      expect(stripAnsi(result)).toContain('and 2 more rows')
    })
  })

  describe('options', () => {
    it('should hide headers when showHeaders is false', () => {
      const result = renderTable(sampleData, { tier: 'text', showHeaders: false })
      expect(result).not.toContain('name')
      expect(result).toContain('Alice')
    })

    it('should use custom columns', () => {
      const result = renderTable(sampleData, {
        tier: 'text',
        columns: [
          { header: 'Person', key: 'name' },
          { header: 'Location', key: 'city' },
        ],
      })
      expect(result).toContain('Person')
      expect(result).toContain('Location')
      expect(result).not.toContain('age')
    })
  })
})

// ============================================================================
// TIER DETECTION TESTS
// ============================================================================

describe('detectTier', () => {
  function createRequest(options: {
    url?: string
    accept?: string
    userAgent?: string
    mcpClient?: string
  } = {}): Request {
    const headers = new Headers()
    if (options.accept) headers.set('Accept', options.accept)
    if (options.userAgent) headers.set('User-Agent', options.userAgent)
    if (options.mcpClient) headers.set('X-MCP-Client', options.mcpClient)

    return new Request(options.url || 'https://example.com', { headers })
  }

  it('should return text by default', () => {
    const request = createRequest()
    expect(detectTier(request)).toBe('text')
  })

  it('should detect ANSI from Accept header', () => {
    expect(detectTier(createRequest({ accept: 'text/x-ansi' }))).toBe('ansi')
    expect(detectTier(createRequest({ accept: 'application/x-ansi' }))).toBe('ansi')
  })

  it('should detect markdown from Accept header', () => {
    expect(detectTier(createRequest({ accept: 'text/markdown' }))).toBe('markdown')
    expect(detectTier(createRequest({ accept: 'text/x-markdown' }))).toBe('markdown')
  })

  it('should detect ANSI from terminal User-Agents', () => {
    expect(detectTier(createRequest({ userAgent: 'curl/7.79.1' }))).toBe('ansi')
    expect(detectTier(createRequest({ userAgent: 'Wget/1.21' }))).toBe('ansi')
    expect(detectTier(createRequest({ userAgent: 'httpie/3.0' }))).toBe('ansi')
  })

  it('should detect markdown from MCP client header', () => {
    expect(detectTier(createRequest({ mcpClient: 'claude-code' }))).toBe('markdown')
  })

  it('should respect query parameter override', () => {
    expect(detectTier(createRequest({ url: 'https://example.com?tier=ansi' }))).toBe('ansi')
    expect(detectTier(createRequest({ url: 'https://example.com?format=markdown' }))).toBe('markdown')
    expect(detectTier(createRequest({ url: 'https://example.com?tier=text' }))).toBe('text')
  })

  it('should prioritize query parameter over headers', () => {
    const request = createRequest({
      url: 'https://example.com?tier=text',
      accept: 'text/x-ansi',
    })
    expect(detectTier(request)).toBe('text')
  })
})

describe('detectCapabilities', () => {
  it('should detect width from query parameter', () => {
    const request = new Request('https://example.com?width=120')
    const caps = detectCapabilities(request)
    expect(caps.width).toBe(120)
  })

  it('should detect width from header', () => {
    const headers = new Headers({ 'X-Terminal-Width': '100' })
    const request = new Request('https://example.com', { headers })
    const caps = detectCapabilities(request)
    expect(caps.width).toBe(100)
  })

  it('should clamp width to reasonable range', () => {
    const tooSmall = new Request('https://example.com?width=10')
    expect(detectCapabilities(tooSmall).width).toBe(40)

    const tooLarge = new Request('https://example.com?width=500')
    expect(detectCapabilities(tooLarge).width).toBe(200)
  })

  it('should detect color depth for ANSI tier', () => {
    const request = new Request('https://example.com?tier=ansi')
    const caps = detectCapabilities(request)
    expect(caps.colorDepth).toBe(256)
  })

  it('should set colorDepth to 0 for text tier', () => {
    const request = new Request('https://example.com?tier=text')
    const caps = detectCapabilities(request)
    expect(caps.colorDepth).toBe(0)
  })
})

// ============================================================================
// TERMINAL RENDERER CLASS TESTS
// ============================================================================

describe('TerminalRenderer', () => {
  describe('constructor', () => {
    it('should use default options', () => {
      const renderer = new TerminalRenderer()
      expect(renderer.tier).toBe('text')
    })

    it('should accept custom options', () => {
      const renderer = new TerminalRenderer({ tier: 'ansi', width: 100 })
      expect(renderer.tier).toBe('ansi')
    })
  })

  describe('fromRequest', () => {
    it('should create renderer from request', () => {
      const request = new Request('https://example.com?tier=markdown')
      const renderer = TerminalRenderer.fromRequest(request)
      expect(renderer.tier).toBe('markdown')
    })
  })

  describe('renderTable', () => {
    it('should render table using instance options', () => {
      const renderer = new TerminalRenderer({ tier: 'markdown' })
      const result = renderer.renderTable([{ a: 1, b: 2 }])
      expect(result).toContain('|')
    })

    it('should allow overriding options', () => {
      const renderer = new TerminalRenderer({ tier: 'text' })
      const result = renderer.renderTable([{ a: 1 }], { tier: 'markdown' })
      expect(result).toContain('|')
    })
  })

  describe('renderProgress', () => {
    it('should render progress bar', () => {
      const renderer = new TerminalRenderer({ tier: 'text' })
      const result = renderer.renderProgress(50, 'Loading')
      expect(result).toContain('Loading')
      expect(result).toContain('50%')
    })
  })

  describe('renderPanel', () => {
    it('should render panel', () => {
      const renderer = new TerminalRenderer({ tier: 'markdown' })
      const result = renderer.renderPanel('Title', 'Content')
      expect(result).toContain('### Title')
    })
  })

  describe('renderBadge', () => {
    it('should render badge', () => {
      const renderer = new TerminalRenderer({ tier: 'ansi' })
      const result = renderer.renderBadge('OK', 'success')
      expect(result).toContain('\x1b[')
    })
  })

  describe('renderSpinner', () => {
    it('should render spinner with frame', () => {
      const renderer = new TerminalRenderer({ tier: 'text' })
      const result = renderer.renderSpinner('Working', 0)
      expect(result).toBe('| Working')
    })
  })

  describe('renderCommandOutput', () => {
    it('should render successful command in text tier', () => {
      const renderer = new TerminalRenderer({ tier: 'text' })
      const result = renderer.renderCommandOutput({
        command: 'ls -la',
        exitCode: 0,
        stdout: 'file1.txt\nfile2.txt',
        stderr: '',
        duration: 50,
      })
      expect(result).toContain('[OK]')
      expect(result).toContain('$ ls -la')
      expect(result).toContain('file1.txt')
      expect(result).toContain('50ms')
    })

    it('should render failed command in text tier', () => {
      const renderer = new TerminalRenderer({ tier: 'text' })
      const result = renderer.renderCommandOutput({
        command: 'cat missing',
        exitCode: 1,
        stdout: '',
        stderr: 'File not found',
      })
      expect(result).toContain('[FAIL]')
      expect(result).toContain('stderr:')
      expect(result).toContain('File not found')
    })

    it('should render command output in markdown tier', () => {
      const renderer = new TerminalRenderer({ tier: 'markdown' })
      const result = renderer.renderCommandOutput({
        command: 'echo hello',
        exitCode: 0,
        stdout: 'hello',
        stderr: '',
      })
      expect(result).toContain('[OK]')
      expect(result).toContain('`$ echo hello`')
      expect(result).toContain('```')
      expect(result).toContain('hello')
    })

    it('should render command output in ansi tier', () => {
      const renderer = new TerminalRenderer({ tier: 'ansi' })
      const result = renderer.renderCommandOutput({
        command: 'pwd',
        exitCode: 0,
        stdout: '/home/user',
        stderr: '',
      })
      expect(result).toContain('\x1b[')
      expect(stripAnsi(result)).toContain('OK')
      expect(stripAnsi(result)).toContain('$ pwd')
      expect(stripAnsi(result)).toContain('/home/user')
    })

    it('should render stderr in red for ansi tier', () => {
      const renderer = new TerminalRenderer({ tier: 'ansi' })
      const result = renderer.renderCommandOutput({
        command: 'bad',
        exitCode: 1,
        stdout: '',
        stderr: 'error message',
      })
      expect(result).toContain('\x1b[31m') // red color code
    })
  })
})

// ============================================================================
// STREAMING RENDERER TESTS
// ============================================================================

import {
  StreamingRenderer,
  createBufferedCallback,
  createWebSocketCallback,
  renderStreamEvents,
  type StreamEvent,
} from '../../src/do/terminal-renderer.js'

describe('StreamingRenderer', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))
      expect(renderer.tier).toBe('text')
    })

    it('should accept custom options', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({ tier: 'ansi' }, (e) => events.push(e))
      expect(renderer.tier).toBe('ansi')
    })
  })

  describe('fromRequest', () => {
    it('should create from request', () => {
      const request = new Request('https://example.com?tier=markdown')
      const events: StreamEvent[] = []
      const renderer = StreamingRenderer.fromRequest(request, (e) => events.push(e))
      expect(renderer.tier).toBe('markdown')
    })
  })

  describe('event emission', () => {
    it('should emit start event', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({ tier: 'text' }, (e) => events.push(e))

      renderer.start('ls -la')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'start',
        command: 'ls -la',
        tier: 'text',
      })
    })

    it('should emit output events', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))

      renderer.output('hello\n', 'stdout')
      renderer.output('error\n', 'stderr')

      expect(events).toHaveLength(2)
      expect(events[0]).toEqual({ type: 'output', content: 'hello\n', stream: 'stdout' })
      expect(events[1]).toEqual({ type: 'output', content: 'error\n', stream: 'stderr' })
    })

    it('should emit progress events', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))

      renderer.progress(50, 'Building')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'progress', percent: 50, label: 'Building' })
    })

    it('should emit table events', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))
      const data = [{ name: 'test', value: 123 }]

      renderer.table(data)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'table', data })
    })

    it('should emit end event', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))

      renderer.end(0, 50)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'end', exitCode: 0, duration: 50 })
    })

    it('should emit error event', () => {
      const events: StreamEvent[] = []
      const renderer = new StreamingRenderer({}, (e) => events.push(e))

      renderer.error('Something went wrong')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'error', message: 'Something went wrong' })
    })
  })

  describe('render methods', () => {
    it('should render command result', () => {
      const renderer = new StreamingRenderer({ tier: 'text' }, () => {})
      const result = renderer.renderResult({
        command: 'echo hello',
        exitCode: 0,
        stdout: 'hello',
        stderr: '',
      })
      expect(result).toContain('[OK]')
      expect(result).toContain('hello')
    })

    it('should render table', () => {
      const renderer = new StreamingRenderer({ tier: 'markdown' }, () => {})
      const result = renderer.renderTable([{ col: 'val' }])
      expect(result).toContain('| col |')
    })

    it('should render progress', () => {
      const renderer = new StreamingRenderer({ tier: 'text' }, () => {})
      const result = renderer.renderProgress(50)
      expect(result).toContain('50%')
    })

    it('should render panel', () => {
      const renderer = new StreamingRenderer({ tier: 'markdown' }, () => {})
      const result = renderer.renderPanel('Title', 'Content')
      expect(result).toContain('### Title')
    })
  })
})

describe('createBufferedCallback', () => {
  it('should buffer events', () => {
    const { callback, getEvents } = createBufferedCallback()

    callback({ type: 'start', command: 'test', tier: 'text' })
    callback({ type: 'output', content: 'output', stream: 'stdout' })
    callback({ type: 'end', exitCode: 0 })

    const events = getEvents()
    expect(events).toHaveLength(3)
    expect(events[0].type).toBe('start')
    expect(events[1].type).toBe('output')
    expect(events[2].type).toBe('end')
  })

  it('should clear events', () => {
    const { callback, getEvents, clear } = createBufferedCallback()

    callback({ type: 'start', command: 'test', tier: 'text' })
    expect(getEvents()).toHaveLength(1)

    clear()
    expect(getEvents()).toHaveLength(0)
  })

  it('should return a copy of events', () => {
    const { callback, getEvents } = createBufferedCallback()

    callback({ type: 'start', command: 'test', tier: 'text' })
    const events1 = getEvents()
    const events2 = getEvents()

    expect(events1).not.toBe(events2)
    expect(events1).toEqual(events2)
  })
})

describe('renderStreamEvents', () => {
  it('should render start event', () => {
    const events: StreamEvent[] = [{ type: 'start', command: 'ls', tier: 'text' }]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toBe('$ ls')
  })

  it('should render output events', () => {
    const events: StreamEvent[] = [
      { type: 'output', content: 'line1\n', stream: 'stdout' },
      { type: 'output', content: 'line2', stream: 'stdout' },
    ]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toBe('line1\n\nline2')
  })

  it('should render stderr in red for ANSI tier', () => {
    const events: StreamEvent[] = [{ type: 'output', content: 'error', stream: 'stderr' }]
    const result = renderStreamEvents(events, { tier: 'ansi' })
    expect(result).toContain('\x1b[31m') // red
    expect(stripAnsi(result)).toBe('error')
  })

  it('should render end event with badge', () => {
    const events: StreamEvent[] = [{ type: 'end', exitCode: 0, duration: 100 }]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toContain('[OK]')
    expect(result).toContain('100ms')
  })

  it('should render failed end event', () => {
    const events: StreamEvent[] = [{ type: 'end', exitCode: 1 }]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toContain('[EXIT 1]')
  })

  it('should render error event', () => {
    const events: StreamEvent[] = [{ type: 'error', message: 'Failed!' }]

    expect(renderStreamEvents(events, { tier: 'text' })).toBe('Error: Failed!')
    expect(renderStreamEvents(events, { tier: 'markdown' })).toBe('**Error:** Failed!')
  })

  it('should render progress events', () => {
    const events: StreamEvent[] = [{ type: 'progress', percent: 50, label: 'Building' }]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toContain('50%')
    expect(result).toContain('Building')
  })

  it('should skip indeterminate progress', () => {
    const events: StreamEvent[] = [{ type: 'progress', percent: -1, label: 'Spinner' }]
    const result = renderStreamEvents(events, { tier: 'text' })
    expect(result).toBe('')
  })

  it('should render table events', () => {
    const events: StreamEvent[] = [{ type: 'table', data: [{ a: 1 }] }]
    const result = renderStreamEvents(events, { tier: 'markdown' })
    expect(result).toContain('| a |')
  })

  it('should render in markdown tier', () => {
    const events: StreamEvent[] = [
      { type: 'start', command: 'npm install', tier: 'markdown' },
      { type: 'end', exitCode: 0 },
    ]
    const result = renderStreamEvents(events, { tier: 'markdown' })
    expect(result).toContain('`$ npm install`')
    expect(result).toContain('`[OK] OK`')
  })
})
