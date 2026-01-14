/**
 * VirtualPTY Tests
 *
 * Comprehensive test suite for the VirtualPTY terminal emulation layer.
 * Tests ANSI parsing, screen buffer management, and event callbacks.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest'
import { VirtualPTY } from '../../../core/pty/virtual-pty.js'
import { ANSIParser } from '../../../core/pty/parser.js'
import { TerminalBuffer } from '../../../core/pty/buffer.js'
import type { ParsedSequence, ScreenChangeEvent, ScreenBuffer, KeyEvent } from '../../../core/pty/types.js'

// ============================================================================
// VirtualPTY Basic Tests
// ============================================================================

describe('VirtualPTY', () => {
  describe('Construction and Configuration', () => {
    it('should create with default dimensions (80x24)', () => {
      const pty = new VirtualPTY()
      const info = pty.getInfo()
      expect(info.cols).toBe(80)
      expect(info.rows).toBe(24)
    })

    it('should create with custom dimensions', () => {
      const pty = new VirtualPTY({ cols: 120, rows: 40 })
      const info = pty.getInfo()
      expect(info.cols).toBe(120)
      expect(info.rows).toBe(40)
    })

    it('should report as TTY', () => {
      const pty = new VirtualPTY()
      expect(pty.isTTY).toBe(true)
      expect(pty.getInfo().isTTY).toBe(true)
    })

    it('should expose columns and rows properties', () => {
      const pty = new VirtualPTY({ cols: 100, rows: 30 })
      expect(pty.columns).toBe(100)
      expect(pty.rows).toBe(30)
    })

    it('should report default term type as xterm-256color', () => {
      const pty = new VirtualPTY()
      expect(pty.getInfo().termType).toBe('xterm-256color')
    })

    it('should allow custom term type', () => {
      const pty = new VirtualPTY({ termType: 'vt100' })
      expect(pty.getInfo().termType).toBe('vt100')
    })
  })

  describe('Writing Data', () => {
    it('should write simple string to buffer', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Hello')
      expect(pty.toString()).toContain('Hello')
    })

    it('should write Uint8Array to buffer', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const data = new TextEncoder().encode('World')
      pty.write(data)
      expect(pty.toString()).toContain('World')
    })

    it('should track bytes written', () => {
      const pty = new VirtualPTY()
      pty.write('Hello')
      pty.write('World')
      expect(pty.getInfo().bytesWritten).toBe(10)
    })

    it('should handle multi-line output', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\nLine2\nLine3')
      const lines = pty.getLines()
      expect(lines[0]).toContain('Line1')
      expect(lines[1]).toContain('Line2')
      expect(lines[2]).toContain('Line3')
    })

    it('should handle carriage return', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('AAAA\rBB')
      const line = pty.getLines()[0]
      expect(line).toContain('BBAA')
    })

    it('should wrap long lines', () => {
      const pty = new VirtualPTY({ cols: 10, rows: 5 })
      pty.write('1234567890ABCDE')
      const lines = pty.getLines()
      expect(lines[0].trim()).toBe('1234567890')
      expect(lines[1]).toContain('ABCDE')
    })
  })

  describe('Cursor Movement (CSI Sequences)', () => {
    it('should move cursor up with CSI A', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\nLine2\n\x1b[2AX')
      const lines = pty.getLines()
      expect(lines[0]).toContain('X')
    })

    it('should move cursor down with CSI B', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\x1b[2BX')
      const lines = pty.getLines()
      expect(lines[2]).toContain('X')
    })

    it('should move cursor forward with CSI C', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('\x1b[5CX')
      const line = pty.getLines()[0]
      expect(line[5]).toBe('X')
    })

    it('should move cursor backward with CSI D', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('HELLO\x1b[3DX')
      const line = pty.getLines()[0]
      expect(line).toContain('HEXLO')
    })

    it('should move to absolute position with CSI H', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('\x1b[3;5HX')
      const lines = pty.getLines()
      expect(lines[2][4]).toBe('X')
    })

    it('should move to column with CSI G', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('1234567890\x1b[5GX')
      const line = pty.getLines()[0]
      expect(line[4]).toBe('X')
    })
  })

  describe('Screen Erasing (CSI J and K)', () => {
    it('should erase to end of line with CSI 0K', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('HELLO WORLD\x1b[6G\x1b[0K')
      const line = pty.getLines()[0]
      expect(line.trim()).toBe('HELLO')
    })

    it('should erase to start of line with CSI 1K', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('HELLO WORLD\x1b[6G\x1b[1K')
      const line = pty.getLines()[0]
      expect(line).toContain('WORLD')
      expect(line.substring(0, 6).trim()).toBe('')
    })

    it('should erase entire line with CSI 2K', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('HELLO WORLD\x1b[2K')
      const line = pty.getLines()[0]
      expect(line.trim()).toBe('')
    })

    it('should erase to end of screen with CSI 0J', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\nLine2\nLine3\x1b[2;1H\x1b[0J')
      const lines = pty.getLines()
      expect(lines[0]).toContain('Line1')
      expect(lines[1].trim()).toBe('')
      expect(lines[2].trim()).toBe('')
    })

    it('should erase entire screen with CSI 2J', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\nLine2\nLine3\x1b[2J')
      expect(pty.toString().trim()).toBe('')
    })
  })

  describe('Colors and Attributes (SGR)', () => {
    it('should track sequence parsing for SGR', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const sequences: ParsedSequence[] = []
      pty.onSequence((seq) => sequences.push(seq))

      pty.write('\x1b[31mRed\x1b[0m')

      // Should have parsed SGR sequences
      const sgrSequences = sequences.filter(s => s.finalChar === 'm')
      expect(sgrSequences.length).toBe(2)
      expect(sgrSequences[0].params).toContain(31) // red foreground
      expect(sgrSequences[1].params).toContain(0)  // reset
    })

    it('should handle 256-color mode', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const sequences: ParsedSequence[] = []
      pty.onSequence((seq) => sequences.push(seq))

      // 38;5;196 = 256-color foreground red
      pty.write('\x1b[38;5;196mColorful\x1b[0m')

      const sgrSequence = sequences.find(s => s.finalChar === 'm' && s.params.includes(38))
      expect(sgrSequence).toBeDefined()
      expect(sgrSequence!.params).toEqual([38, 5, 196])
    })

    it('should handle RGB/truecolor mode', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const sequences: ParsedSequence[] = []
      pty.onSequence((seq) => sequences.push(seq))

      // 38;2;255;0;0 = RGB foreground red
      pty.write('\x1b[38;2;255;0;0mTrueColor\x1b[0m')

      const sgrSequence = sequences.find(s => s.finalChar === 'm' && s.params.includes(38))
      expect(sgrSequence).toBeDefined()
      expect(sgrSequence!.params).toEqual([38, 2, 255, 0, 0])
    })

    it('should handle bold attribute', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const buffer = pty.getScreenBuffer()

      pty.write('\x1b[1mBold\x1b[0m')

      // The buffer should have bold attribute set for those cells
      const cell = buffer.getCell(0, 0)
      expect(cell?.attrs.bold).toBe(true)
    })
  })

  describe('Private Mode Sequences', () => {
    it('should show cursor with CSI ?25h', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('\x1b[?25l') // hide
      expect(pty.getScreenBuffer().cursor.visible).toBe(false)
      pty.write('\x1b[?25h') // show
      expect(pty.getScreenBuffer().cursor.visible).toBe(true)
    })

    it('should hide cursor with CSI ?25l', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      expect(pty.getScreenBuffer().cursor.visible).toBe(true)
      pty.write('\x1b[?25l')
      expect(pty.getScreenBuffer().cursor.visible).toBe(false)
    })
  })

  describe('Scrolling', () => {
    it('should scroll up with CSI S', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      // Write 5 lines, filling the screen
      pty.write('Line1\r\n')
      pty.write('Line2\r\n')
      pty.write('Line3\r\n')
      pty.write('Line4\r\n')
      pty.write('Line5')
      // Move to top and scroll up 2 lines
      pty.write('\x1b[1;1H\x1b[2S')
      const lines = pty.getLines()
      // After scrolling up 2, Line1 and Line2 are gone, Line3 is now at top
      expect(lines[0]).toContain('Line3')
    })

    it('should scroll down with CSI T', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Line1\nLine2\nLine3')
      pty.write('\x1b[1;1H\x1b[2T') // scroll down 2 lines
      const lines = pty.getLines()
      expect(lines[2]).toContain('Line1')
    })

    it('should auto-scroll when writing past bottom', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 3 })
      pty.write('Line1\nLine2\nLine3\nLine4')
      const lines = pty.getLines()
      expect(lines[0]).toContain('Line2')
      expect(lines[2]).toContain('Line4')
    })
  })

  describe('Resize', () => {
    it('should resize the terminal', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      pty.resize(120, 40)
      expect(pty.columns).toBe(120)
      expect(pty.rows).toBe(40)
    })

    it('should preserve content when resizing larger', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Hello')
      pty.resize(40, 10)
      expect(pty.toString()).toContain('Hello')
    })

    it('should clamp cursor when resizing smaller', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      pty.write('\x1b[20;70H') // Move to row 20, col 70
      pty.resize(40, 10)
      const buffer = pty.getScreenBuffer()
      expect(buffer.cursor.x).toBeLessThan(40)
      expect(buffer.cursor.y).toBeLessThan(10)
    })

    it('should emit screen change event on resize', () => {
      const pty = new VirtualPTY({ cols: 80, rows: 24 })
      const events: ScreenChangeEvent[] = []
      pty.onScreenChange((event) => events.push(event))

      pty.resize(120, 40)

      const resizeEvent = events.find(e => e.type === 'resize')
      expect(resizeEvent).toBeDefined()
    })
  })

  describe('Events and Callbacks', () => {
    it('should emit data callback for raw data', () => {
      const pty = new VirtualPTY()
      const received: (string | Uint8Array)[] = []
      pty.onData((data) => received.push(data))

      pty.write('Hello')
      pty.write(new TextEncoder().encode('World'))

      expect(received.length).toBe(2)
      expect(received[0]).toBe('Hello')
    })

    it('should emit screen change callback', () => {
      const pty = new VirtualPTY()
      const callback = vi.fn()
      pty.onScreenChange(callback)

      pty.write('Test')

      expect(callback).toHaveBeenCalled()
      const [event, buffer] = callback.mock.calls[0]
      expect(event.type).toBe('write')
      expect(buffer.cols).toBe(80)
    })

    it('should emit bell event for BEL character', () => {
      const pty = new VirtualPTY()
      const events: any[] = []
      pty.onEvent((event) => events.push(event))

      pty.write('Hello\x07World') // \x07 is BEL

      const bellEvent = events.find(e => e.type === 'bell')
      expect(bellEvent).toBeDefined()
    })

    it('should emit title change event for OSC 0', () => {
      const pty = new VirtualPTY()
      const events: any[] = []
      pty.onEvent((event) => events.push(event))

      pty.write('\x1b]0;My Title\x07')

      const titleEvent = events.find(e => e.type === 'title')
      expect(titleEvent).toBeDefined()
      expect(titleEvent.title).toBe('My Title')
    })

    it('should allow unsubscribing from callbacks', () => {
      const pty = new VirtualPTY()
      const callback = vi.fn()
      const unsubscribe = pty.onScreenChange(callback)

      pty.write('First')
      expect(callback).toHaveBeenCalledTimes(1)

      unsubscribe()
      pty.write('Second')
      expect(callback).toHaveBeenCalledTimes(1) // No additional calls
    })
  })

  describe('Environment Variables', () => {
    it('should provide correct environment variables', () => {
      const pty = new VirtualPTY({ cols: 100, rows: 50 })
      const env = pty.getEnvironment()

      expect(env.TERM).toBe('xterm-256color')
      expect(env.COLUMNS).toBe('100')
      expect(env.LINES).toBe('50')
      expect(env.COLORTERM).toBe('truecolor')
      expect(env.FORCE_COLOR).toBe('3')
    })

    it('should include custom env variables', () => {
      const pty = new VirtualPTY({
        env: { MY_VAR: 'value' },
      })
      const env = pty.getEnvironment()
      expect(env.MY_VAR).toBe('value')
    })
  })

  describe('WritableStream Interface', () => {
    it('should provide a WritableStream', async () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const stream = pty.getWritableStream()

      expect(stream).toBeInstanceOf(WritableStream)

      const writer = stream.getWriter()
      await writer.write(new TextEncoder().encode('Streaming'))
      writer.releaseLock()

      expect(pty.toString()).toContain('Streaming')
    })

    it('should provide a simple writer interface', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      const writer = pty.getWriter()

      writer.write('Hello')
      writer.write(new TextEncoder().encode(' World'))

      expect(pty.toString()).toContain('Hello World')
    })
  })

  describe('Title Management', () => {
    it('should track window title from OSC 0', () => {
      const pty = new VirtualPTY()
      pty.write('\x1b]0;Window Title\x07')
      expect(pty.getTitle()).toBe('Window Title')
    })

    it('should track window title from OSC 2', () => {
      const pty = new VirtualPTY()
      pty.write('\x1b]2;Another Title\x07')
      expect(pty.getTitle()).toBe('Another Title')
    })
  })

  describe('Snapshot', () => {
    it('should create immutable snapshot of buffer state', () => {
      const pty = new VirtualPTY({ cols: 20, rows: 5 })
      pty.write('Before')

      const snapshot = pty.getSnapshot()

      pty.write('After')

      // Snapshot should be unchanged
      expect(snapshot.cells[0][0].char).toBe('B')
    })
  })

  // ==========================================================================
  // Input Handling Tests
  // ==========================================================================

  describe('Input Handling', () => {
    describe('sendInput', () => {
      it('should accept string input', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendInput('hello')

        expect(received).toEqual(['hello'])
      })

      it('should accept Uint8Array input', () => {
        const pty = new VirtualPTY()
        const received: Uint8Array[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? new TextEncoder().encode(data) : data))

        const bytes = new Uint8Array([104, 105]) // 'hi'
        pty.sendInput(bytes)

        expect(received.length).toBe(1)
        expect(received[0]).toEqual(bytes)
      })

      it('should buffer input when no callback registered', () => {
        const pty = new VirtualPTY()
        pty.sendInput('buffered')

        const received: string[] = []
        pty.onInput((data) => {
          // New callbacks should not receive buffered input
          received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
        })

        // Send new input
        pty.sendInput('new')

        expect(received).toEqual(['new'])
      })
    })

    describe('sendKey', () => {
      it('should translate simple key events', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'a' })

        expect(received).toEqual(['a'])
      })

      it('should translate enter key to carriage return', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'return' })

        expect(received).toEqual(['\r'])
      })

      it('should translate escape key', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'escape' })

        expect(received).toEqual(['\x1b'])
      })

      it('should translate arrow keys to ANSI sequences', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'up' })
        pty.sendKey({ key: 'down' })
        pty.sendKey({ key: 'left' })
        pty.sendKey({ key: 'right' })

        expect(received).toEqual([
          '\x1b[A', // up
          '\x1b[B', // down
          '\x1b[D', // left
          '\x1b[C', // right
        ])
      })

      it('should handle ctrl modifier', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'c', ctrl: true })

        expect(received).toEqual(['\x03']) // Ctrl+C
      })

      it('should handle tab key', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'tab' })

        expect(received).toEqual(['\t'])
      })

      it('should handle backspace key', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'backspace' })

        expect(received).toEqual(['\x7f']) // DEL character
      })

      it('should handle delete key', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'delete' })

        expect(received).toEqual(['\x1b[3~'])
      })

      it('should handle home and end keys', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'home' })
        pty.sendKey({ key: 'end' })

        expect(received).toEqual(['\x1b[H', '\x1b[F'])
      })

      it('should handle page up and page down', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendKey({ key: 'pageup' })
        pty.sendKey({ key: 'pagedown' })

        expect(received).toEqual(['\x1b[5~', '\x1b[6~'])
      })
    })

    describe('Raw Mode', () => {
      it('should start in cooked mode by default', () => {
        const pty = new VirtualPTY()
        expect(pty.isRawMode).toBe(false)
      })

      it('should allow setting raw mode', () => {
        const pty = new VirtualPTY()
        pty.setRawMode(true)
        expect(pty.isRawMode).toBe(true)
      })

      it('should allow disabling raw mode', () => {
        const pty = new VirtualPTY()
        pty.setRawMode(true)
        pty.setRawMode(false)
        expect(pty.isRawMode).toBe(false)
      })
    })

    describe('Device Status Report (DSR)', () => {
      it('should respond to cursor position request (DSR 6)', () => {
        const pty = new VirtualPTY({ cols: 80, rows: 24 })
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        // Move cursor to row 5, col 10
        pty.write('\x1b[5;10H')

        // Request cursor position (DSR 6)
        pty.write('\x1b[6n')

        // Should receive CPR (Cursor Position Report): ESC [ row ; col R
        expect(received).toEqual(['\x1b[5;10R'])
      })

      it('should respond to device status request (DSR 5)', () => {
        const pty = new VirtualPTY()
        const received: string[] = []
        pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        // Request device status (DSR 5)
        pty.write('\x1b[5n')

        // Should receive "device OK" response
        expect(received).toEqual(['\x1b[0n'])
      })
    })

    describe('onInput callback', () => {
      it('should allow multiple input callbacks', () => {
        const pty = new VirtualPTY()
        const received1: string[] = []
        const received2: string[] = []

        pty.onInput((data) => received1.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))
        pty.onInput((data) => received2.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendInput('test')

        expect(received1).toEqual(['test'])
        expect(received2).toEqual(['test'])
      })

      it('should allow unsubscribing from input callback', () => {
        const pty = new VirtualPTY()
        const received: string[] = []

        const unsubscribe = pty.onInput((data) => received.push(typeof data === 'string' ? data : new TextDecoder().decode(data)))

        pty.sendInput('first')
        unsubscribe()
        pty.sendInput('second')

        expect(received).toEqual(['first'])
      })
    })

    describe('getReadableStream', () => {
      it('should provide a ReadableStream for input', async () => {
        const pty = new VirtualPTY()
        const stream = pty.getReadableStream()

        expect(stream).toBeInstanceOf(ReadableStream)

        // Send some input
        pty.sendInput('streaming')

        // Read from the stream
        const reader = stream.getReader()
        const { value, done } = await reader.read()
        reader.releaseLock()

        expect(done).toBe(false)
        expect(new TextDecoder().decode(value)).toBe('streaming')
      })
    })
  })
})

// ============================================================================
// ANSIParser Tests
// ============================================================================

describe('ANSIParser', () => {
  describe('State Machine', () => {
    it('should start in ground state', () => {
      const parser = new ANSIParser()
      expect(parser.getState()).toBe('ground')
    })

    it('should parse printable characters', () => {
      const chars: string[] = []
      const parser = new ANSIParser({
        onPrint: (char) => chars.push(char),
      })

      parser.parse('Hello')

      expect(chars.join('')).toBe('Hello')
    })

    it('should parse CSI sequences', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse('\x1b[31m')

      expect(sequences.length).toBe(1)
      expect(sequences[0].type).toBe('csi')
      expect(sequences[0].finalChar).toBe('m')
      expect(sequences[0].params).toEqual([31])
    })

    it('should parse CSI with multiple params', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse('\x1b[10;20H')

      expect(sequences[0].params).toEqual([10, 20])
    })

    it('should parse CSI with private marker', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse('\x1b[?25h')

      expect(sequences[0].privateMarker).toBe('?')
      expect(sequences[0].params).toEqual([25])
    })

    it('should execute control characters', () => {
      const executed: number[] = []
      const parser = new ANSIParser({
        onExecute: (code) => executed.push(code),
      })

      parser.parse('A\nB\rC')

      expect(executed).toContain(0x0a) // LF
      expect(executed).toContain(0x0d) // CR
    })

    it('should handle escape sequences', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse('\x1b7') // DECSC - Save Cursor

      expect(sequences[0].type).toBe('esc')
      expect(sequences[0].finalChar).toBe('7')
    })

    it('should handle CAN to abort sequence', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse('\x1b[31\x18m') // CAN (0x18) aborts the sequence

      // The incomplete sequence should be aborted
      expect(sequences.length).toBe(0)
    })

    it('should handle SUB to abort sequence', () => {
      const parser = new ANSIParser()
      parser.parse('\x1b[31\x1A') // SUB (0x1A) aborts
      expect(parser.getState()).toBe('ground')
    })

    it('should reset parser state', () => {
      const parser = new ANSIParser()
      parser.parse('\x1b[') // Start CSI
      expect(parser.getState()).toBe('csi_entry')

      parser.reset()
      expect(parser.getState()).toBe('ground')
    })

    it('should handle OSC sequences', () => {
      const oscParams: string[][] = []
      const parser = new ANSIParser({
        onOSC: (params) => oscParams.push(params),
      })

      parser.parse('\x1b]0;Terminal Title\x07')

      expect(oscParams.length).toBe(1)
      expect(oscParams[0]).toEqual(['0', 'Terminal Title'])
    })
  })

  describe('8-bit C1 Controls', () => {
    it('should handle 8-bit CSI (0x9B)', () => {
      const sequences: ParsedSequence[] = []
      const parser = new ANSIParser({
        onSequence: (seq) => sequences.push(seq),
      })

      parser.parse(new Uint8Array([0x9b, 0x33, 0x31, 0x6d])) // CSI 31 m

      expect(sequences.length).toBe(1)
      expect(sequences[0].type).toBe('csi')
    })
  })
})

// ============================================================================
// TerminalBuffer Tests
// ============================================================================

describe('TerminalBuffer', () => {
  describe('Construction', () => {
    it('should create with specified dimensions', () => {
      const buffer = new TerminalBuffer(100, 50)
      expect(buffer.cols).toBe(100)
      expect(buffer.rows).toBe(50)
    })

    it('should initialize with empty cells', () => {
      const buffer = new TerminalBuffer(10, 5)
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 10; x++) {
          expect(buffer.cells[y][x].char).toBe(' ')
        }
      }
    })

    it('should initialize cursor at origin', () => {
      const buffer = new TerminalBuffer()
      expect(buffer.cursor.x).toBe(0)
      expect(buffer.cursor.y).toBe(0)
    })
  })

  describe('Writing', () => {
    it('should write character at cursor', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeChar('A')
      expect(buffer.cells[0][0].char).toBe('A')
    })

    it('should advance cursor after write', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeChar('A')
      expect(buffer.cursor.x).toBe(1)
    })

    it('should write string', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Hello')
      expect(buffer.getLine(0)).toBe('Hello     ')
    })

    it('should wrap at end of line', () => {
      const buffer = new TerminalBuffer(5, 3)
      buffer.writeString('ABCDEFGH')
      expect(buffer.getLine(0)).toBe('ABCDE')
      expect(buffer.getLine(1)).toContain('FGH')
    })
  })

  describe('Cursor Movement', () => {
    it('should move cursor to absolute position', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(5, 3)
      expect(buffer.cursor.x).toBe(5)
      expect(buffer.cursor.y).toBe(3)
    })

    it('should clamp cursor to bounds', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(100, 100)
      expect(buffer.cursor.x).toBe(19)
      expect(buffer.cursor.y).toBe(9)
    })

    it('should move cursor up', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(0, 5)
      buffer.cursorUp(2)
      expect(buffer.cursor.y).toBe(3)
    })

    it('should not move cursor above scroll region', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.setScrollRegion(2, 8)
      buffer.moveCursor(0, 3)
      buffer.cursorUp(10)
      expect(buffer.cursor.y).toBe(2)
    })

    it('should move cursor down', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.cursorDown(3)
      expect(buffer.cursor.y).toBe(3)
    })

    it('should carriage return to column 0', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(10, 5)
      buffer.carriageReturn()
      expect(buffer.cursor.x).toBe(0)
      expect(buffer.cursor.y).toBe(5)
    })

    it('should line feed and scroll if needed', () => {
      const buffer = new TerminalBuffer(20, 3)
      buffer.writeString('Line1')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line2')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line3')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line4')

      // Should have scrolled, Line1 gone
      expect(buffer.getLine(0)).toContain('Line2')
    })

    it('should tab to next tab stop', () => {
      const buffer = new TerminalBuffer(80, 24)
      buffer.tab()
      expect(buffer.cursor.x).toBe(8)
      buffer.tab()
      expect(buffer.cursor.x).toBe(16)
    })

    it('should backspace', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(5, 0)
      buffer.backspace()
      expect(buffer.cursor.x).toBe(4)
    })

    it('should not backspace past column 0', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.backspace()
      expect(buffer.cursor.x).toBe(0)
    })
  })

  describe('Erasing', () => {
    it('should erase to end of line', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO WORL')
      buffer.moveCursor(5, 0)
      buffer.eraseToEndOfLine()
      expect(buffer.getLine(0)).toBe('HELLO     ')
    })

    it('should erase to start of line', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO WORL')
      buffer.moveCursor(5, 0)
      buffer.eraseToStartOfLine()
      expect(buffer.getLine(0)).toBe('      WORL')
    })

    it('should erase entire line', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO WORL')
      buffer.eraseLine()
      expect(buffer.getLine(0).trim()).toBe('')
    })

    it('should erase screen', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('WORLD')
      buffer.eraseScreen()
      expect(buffer.toString().trim()).toBe('')
    })
  })

  describe('Scrolling', () => {
    it('should scroll up', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Line1')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line2')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line3')

      buffer.scrollUp(1)

      expect(buffer.getLine(0)).toContain('Line2')
    })

    it('should scroll down', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Line1')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line2')

      buffer.scrollDown(1)

      expect(buffer.getLine(1)).toContain('Line1')
    })

    it('should respect scroll region', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.setScrollRegion(1, 3)
      expect(buffer.scrollTop).toBe(1)
      expect(buffer.scrollBottom).toBe(3)
    })
  })

  describe('Insert/Delete', () => {
    it('should insert characters', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO')
      buffer.moveCursor(2, 0)
      buffer.insertChars(2)
      expect(buffer.getLine(0)).toContain('HE  LLO')
    })

    it('should delete characters', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('HELLO')
      buffer.moveCursor(2, 0)
      buffer.deleteChars(2)
      expect(buffer.getLine(0)).toContain('HEO')
    })

    it('should insert lines', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Line1')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line2')
      buffer.moveCursor(0, 0)
      buffer.insertLines(1)

      expect(buffer.getLine(0).trim()).toBe('')
      expect(buffer.getLine(1)).toContain('Line1')
    })

    it('should delete lines', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Line1')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line2')
      buffer.lineFeed()
      buffer.carriageReturn()
      buffer.writeString('Line3')
      buffer.moveCursor(0, 0)
      buffer.deleteLines(1)

      expect(buffer.getLine(0)).toContain('Line2')
    })
  })

  describe('Attributes', () => {
    it('should set foreground color', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.setForeground(1)
      buffer.writeChar('R')
      expect(buffer.cells[0][0].attrs.fg).toBe(1)
    })

    it('should set background color', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.setBackground(4)
      buffer.writeChar('B')
      expect(buffer.cells[0][0].attrs.bg).toBe(4)
    })

    it('should reset attributes', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.setAttribute('bold', true)
      buffer.setAttribute('italic', true)
      buffer.resetAttributes()
      expect(buffer.defaultAttrs.bold).toBe(false)
      expect(buffer.defaultAttrs.italic).toBe(false)
    })

    it('should save and restore cursor', () => {
      const buffer = new TerminalBuffer(20, 10)
      buffer.moveCursor(5, 3)
      buffer.setForeground(2)
      buffer.saveCursor()

      buffer.moveCursor(10, 8)
      buffer.setForeground(5)

      buffer.restoreCursor()

      expect(buffer.cursor.x).toBe(5)
      expect(buffer.cursor.y).toBe(3)
      expect(buffer.defaultAttrs.fg).toBe(2)
    })
  })

  describe('Resize', () => {
    it('should resize buffer', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Hello')
      buffer.resize(20, 10)

      expect(buffer.cols).toBe(20)
      expect(buffer.rows).toBe(10)
      expect(buffer.getLine(0)).toContain('Hello')
    })

    it('should truncate content when resizing smaller', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('ABCDEFGHIJ')
      buffer.resize(5, 3)

      expect(buffer.cols).toBe(5)
      expect(buffer.getLine(0)).toBe('ABCDE')
    })
  })

  describe('Snapshot', () => {
    it('should create snapshot of buffer state', () => {
      const buffer = new TerminalBuffer(10, 5)
      buffer.writeString('Test')
      buffer.moveCursor(2, 1)

      const snapshot = buffer.snapshot()

      expect(snapshot.cols).toBe(10)
      expect(snapshot.rows).toBe(5)
      expect(snapshot.cursor.x).toBe(2)
      expect(snapshot.cursor.y).toBe(1)
      expect(snapshot.cells[0][0].char).toBe('T')
    })
  })
})
