/**
 * React Ink Adapter Tests
 *
 * TDD tests for the InkAdapter class that bridges React Ink
 * with VirtualPTY for headless terminal rendering.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { VirtualPTY } from './virtual-pty.js'
import {
  InkAdapter,
  createInkStreams,
  createInkStdout,
  createInkStdin,
  createInkStderr,
  type InkStreams,
  type InkAdapterOptions,
} from './ink-adapter.js'

describe('InkAdapter', () => {
  let pty: VirtualPTY
  let adapter: InkAdapter

  beforeEach(() => {
    pty = new VirtualPTY({ cols: 80, rows: 24 })
  })

  afterEach(() => {
    adapter?.dispose()
  })

  describe('creation', () => {
    it('should create an InkAdapter from VirtualPTY', () => {
      adapter = new InkAdapter(pty)
      expect(adapter).toBeInstanceOf(InkAdapter)
    })

    it('should accept optional configuration', () => {
      const options: InkAdapterOptions = {
        debug: false,
        exitOnCtrlC: true,
      }
      adapter = new InkAdapter(pty, options)
      expect(adapter).toBeInstanceOf(InkAdapter)
    })
  })

  describe('streams', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should provide stdout stream', () => {
      const { stdout } = adapter.getStreams()
      expect(stdout).toBeDefined()
      expect(stdout.isTTY).toBe(true)
    })

    it('should provide stderr stream', () => {
      const { stderr } = adapter.getStreams()
      expect(stderr).toBeDefined()
      expect(stderr.isTTY).toBe(true)
    })

    it('should provide stdin stream', () => {
      const { stdin } = adapter.getStreams()
      expect(stdin).toBeDefined()
      expect(stdin.isTTY).toBe(true)
    })

    it('should expose columns property on stdout', () => {
      const { stdout } = adapter.getStreams()
      expect(stdout.columns).toBe(80)
    })

    it('should expose rows property on stdout', () => {
      const { stdout } = adapter.getStreams()
      expect(stdout.rows).toBe(24)
    })

    it('should update columns/rows on resize', () => {
      const { stdout } = adapter.getStreams()
      expect(stdout.columns).toBe(80)
      expect(stdout.rows).toBe(24)

      pty.resize(120, 40)

      expect(stdout.columns).toBe(120)
      expect(stdout.rows).toBe(40)
    })
  })

  describe('stdout write', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should write string data to VirtualPTY', () => {
      const { stdout } = adapter.getStreams()

      stdout.write('Hello World')

      expect(pty.toString()).toContain('Hello World')
    })

    it('should write Buffer data to VirtualPTY', () => {
      const { stdout } = adapter.getStreams()

      stdout.write(Buffer.from('Buffer Test'))

      expect(pty.toString()).toContain('Buffer Test')
    })

    it('should write Uint8Array data to VirtualPTY', () => {
      const { stdout } = adapter.getStreams()
      const data = new TextEncoder().encode('Uint8Array Test')

      stdout.write(data)

      expect(pty.toString()).toContain('Uint8Array Test')
    })

    it('should call callback after write', async () => {
      const { stdout } = adapter.getStreams()

      await new Promise<void>((resolve) => {
        stdout.write('test', () => {
          resolve()
        })
      })
    })

    it('should handle ANSI escape sequences', () => {
      const { stdout } = adapter.getStreams()

      // Write colored text
      stdout.write('\x1b[31mRed\x1b[0m')

      // The text should be in the buffer
      expect(pty.toString()).toContain('Red')
    })
  })

  describe('stderr write', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should write to VirtualPTY', () => {
      const { stderr } = adapter.getStreams()

      stderr.write('Error message')

      expect(pty.toString()).toContain('Error message')
    })
  })

  describe('stdin input', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should emit data events when input is sent to PTY', async () => {
      const { stdin } = adapter.getStreams()

      const dataPromise = new Promise<void>((resolve) => {
        stdin.on('data', (data: Buffer) => {
          expect(data.toString()).toBe('hello')
          resolve()
        })
      })

      // Send input through the PTY
      pty.sendInput('hello')
      await dataPromise
    })

    it('should support setRawMode', () => {
      const { stdin } = adapter.getStreams()

      expect(stdin.isRaw).toBe(false)
      stdin.setRawMode(true)
      expect(stdin.isRaw).toBe(true)
      expect(pty.isRawMode).toBe(true)
    })

    it('should report isRawModeSupported as true', () => {
      const { stdin } = adapter.getStreams()
      expect(stdin.isRawModeSupported).toBe(true)
    })
  })

  describe('resize events', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should emit resize event on stdout when PTY resizes', async () => {
      const { stdout } = adapter.getStreams()

      const resizePromise = new Promise<void>((resolve) => {
        stdout.on('resize', () => {
          expect(stdout.columns).toBe(120)
          expect(stdout.rows).toBe(40)
          resolve()
        })
      })

      pty.resize(120, 40)
      await resizePromise
    })
  })

  describe('Ink render options', () => {
    beforeEach(() => {
      adapter = new InkAdapter(pty)
    })

    it('should return options compatible with Ink render()', () => {
      const options = adapter.getInkOptions()

      expect(options.stdout).toBeDefined()
      expect(options.stdin).toBeDefined()
      expect(options.stderr).toBeDefined()
      expect(typeof options.debug).toBe('boolean')
      expect(typeof options.exitOnCtrlC).toBe('boolean')
      expect(typeof options.patchConsole).toBe('boolean')
    })

    it('should respect debug option', () => {
      adapter = new InkAdapter(pty, { debug: true })
      const options = adapter.getInkOptions()
      expect(options.debug).toBe(true)
    })

    it('should respect exitOnCtrlC option', () => {
      adapter = new InkAdapter(pty, { exitOnCtrlC: false })
      const options = adapter.getInkOptions()
      expect(options.exitOnCtrlC).toBe(false)
    })

    it('should respect patchConsole option', () => {
      adapter = new InkAdapter(pty, { patchConsole: false })
      const options = adapter.getInkOptions()
      expect(options.patchConsole).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('should dispose resources cleanly', () => {
      adapter = new InkAdapter(pty)
      const { stdout, stdin } = adapter.getStreams()

      // Set up listeners
      const resizeHandler = vi.fn()
      const dataHandler = vi.fn()
      stdout.on('resize', resizeHandler)
      stdin.on('data', dataHandler)

      // Dispose
      adapter.dispose()

      // Resize should not trigger handler after dispose
      pty.resize(100, 30)
      expect(resizeHandler).not.toHaveBeenCalled()

      // Input should not trigger handler after dispose
      pty.sendInput('test')
      expect(dataHandler).not.toHaveBeenCalled()
    })

    it('should be safe to call dispose multiple times', () => {
      adapter = new InkAdapter(pty)
      expect(() => {
        adapter.dispose()
        adapter.dispose()
      }).not.toThrow()
    })
  })
})

describe('createInkStreams helper', () => {
  it('should create streams without full adapter', () => {
    const pty = new VirtualPTY({ cols: 80, rows: 24 })
    const streams = createInkStreams(pty)

    expect(streams.stdout).toBeDefined()
    expect(streams.stderr).toBeDefined()
    expect(streams.stdin).toBeDefined()
    expect(streams.stdout.isTTY).toBe(true)
  })
})

describe('Individual stream helper functions', () => {
  describe('createInkStdout', () => {
    it('should create a write stream for stdout', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdout = createInkStdout(pty)

      expect(stdout).toBeDefined()
      expect(stdout.isTTY).toBe(true)
      expect(stdout.columns).toBe(80)
      expect(stdout.rows).toBe(24)
    })

    it('should write data to VirtualPTY', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdout = createInkStdout(pty)

      stdout.write('Hello from stdout')

      expect(pty.toString()).toContain('Hello from stdout')
    })

    it('should support cursor movement methods', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdout = createInkStdout(pty)

      stdout.cursorTo(10, 5)

      const cursor = pty.getScreenBuffer().cursor
      expect(cursor.x).toBe(10)
      expect(cursor.y).toBe(5)
    })
  })

  describe('createInkStdin', () => {
    it('should create a read stream for stdin', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdin = createInkStdin(pty)

      expect(stdin).toBeDefined()
      expect(stdin.isTTY).toBe(true)
      expect(stdin.isRawModeSupported).toBe(true)
    })

    it('should support setRawMode', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdin = createInkStdin(pty)

      expect(stdin.isRaw).toBe(false)
      stdin.setRawMode(true)
      expect(stdin.isRaw).toBe(true)
      expect(pty.isRawMode).toBe(true)
    })

    it('should emit data events when input is sent to PTY', async () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stdin = createInkStdin(pty)

      const dataPromise = new Promise<void>((resolve) => {
        stdin.on('data', (data: Buffer) => {
          expect(data.toString()).toBe('test input')
          resolve()
        })
      })

      pty.sendInput('test input')
      await dataPromise
    })
  })

  describe('createInkStderr', () => {
    it('should create a write stream for stderr', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stderr = createInkStderr(pty)

      expect(stderr).toBeDefined()
      expect(stderr.isTTY).toBe(true)
    })

    it('should write data to VirtualPTY', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const stderr = createInkStderr(pty)

      stderr.write('Error message')

      expect(pty.toString()).toContain('Error message')
    })
  })

  describe('Example usage from issue', () => {
    it('should work with the documented example pattern', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })

      // This is the pattern from the issue description
      const stdout = createInkStdout(pty)
      const stdin = createInkStdin(pty)

      // Verify they can be used as Ink render options
      const inkOptions = {
        stdout,
        stdin,
        debug: false,
        exitOnCtrlC: true,
        patchConsole: false,
      }

      expect(inkOptions.stdout.isTTY).toBe(true)
      expect(inkOptions.stdin.isTTY).toBe(true)
      expect(inkOptions.stdout.columns).toBe(80)
      expect(inkOptions.stdout.rows).toBe(24)

      // Verify writing works
      inkOptions.stdout.write('Ink App Output')
      expect(pty.toString()).toContain('Ink App Output')

      // Verify input handling works
      let received = ''
      inkOptions.stdin.on('data', (data: Buffer) => {
        received = data.toString()
      })
      pty.sendInput('user input')
      expect(received).toBe('user input')

      // Cleanup
      stdout.dispose()
      stdin.dispose()
    })
  })
})

describe('InkAdapter with key events', () => {
  let pty: VirtualPTY
  let adapter: InkAdapter

  beforeEach(() => {
    pty = new VirtualPTY({ cols: 80, rows: 24 })
    adapter = new InkAdapter(pty)
  })

  afterEach(() => {
    adapter?.dispose()
  })

  it('should handle Ctrl+C when exitOnCtrlC is enabled', async () => {
    adapter = new InkAdapter(pty, { exitOnCtrlC: true })
    const { stdin } = adapter.getStreams()

    const dataPromise = new Promise<void>((resolve) => {
      stdin.on('data', (data: Buffer) => {
        // Ctrl+C is ASCII 0x03
        expect(data[0]).toBe(0x03)
        resolve()
      })
    })

    pty.sendKey({ key: 'c', ctrl: true })
    await dataPromise
  })

  it('should translate arrow key events', async () => {
    const { stdin } = adapter.getStreams()

    const dataPromise = new Promise<void>((resolve) => {
      stdin.on('data', (data: Buffer) => {
        // Up arrow is ESC [ A
        expect(data.toString()).toBe('\x1b[A')
        resolve()
      })
    })

    pty.sendKey({ key: 'up' })
    await dataPromise
  })
})

describe('InkAdapter writable stream interface', () => {
  let pty: VirtualPTY
  let adapter: InkAdapter

  beforeEach(() => {
    pty = new VirtualPTY({ cols: 80, rows: 24 })
    adapter = new InkAdapter(pty)
  })

  afterEach(() => {
    adapter?.dispose()
  })

  it('should support clearLine', () => {
    const { stdout } = adapter.getStreams()

    // Write some text first
    stdout.write('Hello')

    // Clear line - this writes ANSI sequence to PTY
    stdout.clearLine(0)

    // The clear line call should have written ESC[2K
    // VirtualPTY will process this
  })

  it('should support cursorTo', () => {
    const { stdout } = adapter.getStreams()

    // Move cursor - this writes ANSI sequence to PTY
    stdout.cursorTo(10, 5)

    // Cursor should have moved
    const cursor = pty.getScreenBuffer().cursor
    expect(cursor.x).toBe(10)
    expect(cursor.y).toBe(5)
  })

  it('should support moveCursor', () => {
    const { stdout } = adapter.getStreams()

    // First position cursor
    stdout.cursorTo(10, 10)

    // Then move relatively
    stdout.moveCursor(5, -2)

    const cursor = pty.getScreenBuffer().cursor
    expect(cursor.x).toBe(15)
    expect(cursor.y).toBe(8)
  })

  it('should support getWindowSize', () => {
    const { stdout } = adapter.getStreams()

    const size = stdout.getWindowSize()
    expect(size).toEqual([80, 24])
  })

  it('should support getColorDepth', () => {
    const { stdout } = adapter.getStreams()

    // VirtualPTY supports 256 colors by default
    const depth = stdout.getColorDepth()
    expect(depth).toBeGreaterThanOrEqual(8) // 256 colors = 8-bit
  })

  it('should support hasColors', () => {
    const { stdout } = adapter.getStreams()

    expect(stdout.hasColors()).toBe(true)
    expect(stdout.hasColors(256)).toBe(true)
    expect(stdout.hasColors(16)).toBe(true)
  })
})
