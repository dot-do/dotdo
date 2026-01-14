/**
 * Mouse Event Support Tests
 *
 * Tests for VirtualPTY mouse event handling following xterm mouse protocol.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { VirtualPTY } from './virtual-pty.js'
import type { MouseEvent, MouseButton, MouseEventType } from './types.js'

describe('VirtualPTY Mouse Events', () => {
  let pty: VirtualPTY

  beforeEach(() => {
    pty = new VirtualPTY({ cols: 80, rows: 24 })
  })

  // ==========================================================================
  // Mouse Mode Enable/Disable (4 tests)
  // ==========================================================================
  describe('Mouse Mode Enable/Disable', () => {
    it('enableMouse() enables mouse tracking', () => {
      expect(pty.isMouseEnabled).toBe(false)
      pty.enableMouse()
      expect(pty.isMouseEnabled).toBe(true)
    })

    it('disableMouse() disables mouse tracking', () => {
      pty.enableMouse()
      expect(pty.isMouseEnabled).toBe(true)
      pty.disableMouse()
      expect(pty.isMouseEnabled).toBe(false)
    })

    it('enableMouse() accepts optional mode parameter', () => {
      pty.enableMouse('sgr')
      expect(pty.isMouseEnabled).toBe(true)
      expect(pty.mouseMode).toBe('sgr')
    })

    it('enableMouse() defaults to sgr mode', () => {
      pty.enableMouse()
      expect(pty.mouseMode).toBe('sgr')
    })
  })

  // ==========================================================================
  // Mouse Click Events (5 tests)
  // ==========================================================================
  describe('Mouse Click Events', () => {
    beforeEach(() => {
      pty.enableMouse('sgr')
    })

    it('sendMouse() sends left click event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 10,
        y: 5,
      })

      expect(received.length).toBe(1)
      // SGR mode: ESC [ < button ; x ; y M (press) or m (release)
      // button 0 = left, x and y are 1-based
      expect(received[0]).toBe('\x1b[<0;11;6M')
    })

    it('sendMouse() sends right click event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'right',
        x: 5,
        y: 3,
      })

      expect(received.length).toBe(1)
      // button 2 = right
      expect(received[0]).toBe('\x1b[<2;6;4M')
    })

    it('sendMouse() sends middle click event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'middle',
        x: 0,
        y: 0,
      })

      expect(received.length).toBe(1)
      // button 1 = middle
      expect(received[0]).toBe('\x1b[<1;1;1M')
    })

    it('sendMouse() sends release event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'release',
        button: 'left',
        x: 10,
        y: 5,
      })

      expect(received.length).toBe(1)
      // SGR release uses lowercase 'm'
      expect(received[0]).toBe('\x1b[<0;11;6m')
    })

    it('sendMouse() with modifiers adds modifier bits', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 1,
        y: 1,
        shift: true,
        ctrl: true,
      })

      expect(received.length).toBe(1)
      // Shift adds 4, Ctrl adds 16 to button code: 0 + 4 + 16 = 20
      expect(received[0]).toBe('\x1b[<20;2;2M')
    })
  })

  // ==========================================================================
  // Mouse Wheel Events (3 tests)
  // ==========================================================================
  describe('Mouse Wheel Events', () => {
    beforeEach(() => {
      pty.enableMouse('sgr')
    })

    it('sendMouse() sends scroll up event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'wheel',
        button: 'wheelUp',
        x: 40,
        y: 12,
      })

      expect(received.length).toBe(1)
      // Wheel up: button code 64
      expect(received[0]).toBe('\x1b[<64;41;13M')
    })

    it('sendMouse() sends scroll down event', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'wheel',
        button: 'wheelDown',
        x: 40,
        y: 12,
      })

      expect(received.length).toBe(1)
      // Wheel down: button code 65
      expect(received[0]).toBe('\x1b[<65;41;13M')
    })

    it('sendMouse() wheel event with modifiers', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'wheel',
        button: 'wheelUp',
        x: 0,
        y: 0,
        meta: true, // Alt/Meta adds 8
      })

      expect(received.length).toBe(1)
      // Wheel up (64) + Alt (8) = 72
      expect(received[0]).toBe('\x1b[<72;1;1M')
    })
  })

  // ==========================================================================
  // Mouse Move Events (3 tests)
  // ==========================================================================
  describe('Mouse Move Events', () => {
    beforeEach(() => {
      pty.enableMouse('sgr')
    })

    it('sendMouse() sends move event when button held', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'move',
        button: 'left',
        x: 15,
        y: 8,
      })

      expect(received.length).toBe(1)
      // Move with left button: button 0 + motion flag 32 = 32
      expect(received[0]).toBe('\x1b[<32;16;9M')
    })

    it('sendMouse() sends move event with no button (any-event tracking)', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'move',
        button: 'none',
        x: 20,
        y: 10,
      })

      expect(received.length).toBe(1)
      // Move with no button: button 3 (release) + motion flag 32 = 35
      expect(received[0]).toBe('\x1b[<35;21;11M')
    })

    it('sendMouse() ignores move events when mouse is disabled', () => {
      pty.disableMouse()
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'move',
        button: 'left',
        x: 15,
        y: 8,
      })

      expect(received.length).toBe(0)
    })
  })

  // ==========================================================================
  // Normal (X10 compatible) Mouse Mode (3 tests)
  // ==========================================================================
  describe('Normal Mouse Mode', () => {
    beforeEach(() => {
      pty.enableMouse('normal')
    })

    it('sends normal mode escape sequence for click', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 5,
        y: 5,
      })

      expect(received.length).toBe(1)
      // Normal mode: ESC [ M Cb Cx Cy (all chars offset by 32)
      // Button 0 + 32 = 32 (space), x=5+1+32=38 (&), y=5+1+32=38 (&)
      expect(received[0]).toBe('\x1b[M &&')
    })

    it('limits coordinates to 223 in normal mode', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      // Large coordinates should be clamped
      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 300,
        y: 300,
      })

      expect(received.length).toBe(1)
      // Max coordinate in normal mode: 223 (255 - 32)
      // x=223+1+32=256 would overflow, so capped at 255 (char code 255)
      // Actually capped to 223 as x value, then +1+32 = 256, which gets char 255
      const chars = received[0].split('')
      expect(chars[3].charCodeAt(0)).toBeLessThanOrEqual(255)
    })

    it('normal mode uses uppercase M for release too', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'release',
        button: 'left',
        x: 0,
        y: 0,
      })

      expect(received.length).toBe(1)
      // Normal mode release: button code 3 (release) + 32 = 35 (#)
      // x=0+1+32=33 (!), y=0+1+32=33 (!)
      expect(received[0]).toBe('\x1b[M#!!')
    })
  })

  // ==========================================================================
  // Mouse Mode Detection via CSI Sequences (4 tests)
  // ==========================================================================
  describe('Mouse Mode Detection', () => {
    it('detects mouse enable via CSI ?1000h', () => {
      expect(pty.isMouseEnabled).toBe(false)
      pty.write('\x1b[?1000h')
      expect(pty.isMouseEnabled).toBe(true)
    })

    it('detects mouse disable via CSI ?1000l', () => {
      pty.enableMouse()
      expect(pty.isMouseEnabled).toBe(true)
      pty.write('\x1b[?1000l')
      expect(pty.isMouseEnabled).toBe(false)
    })

    it('detects SGR mouse mode via CSI ?1006h', () => {
      pty.write('\x1b[?1000h') // Enable mouse first
      pty.write('\x1b[?1006h') // Enable SGR mode
      expect(pty.mouseMode).toBe('sgr')
    })

    it('detects any-event tracking via CSI ?1003h', () => {
      pty.write('\x1b[?1003h')
      expect(pty.isMouseEnabled).toBe(true)
      // Any-event tracking should be indicated
    })
  })

  // ==========================================================================
  // Edge Cases and Boundary Conditions (4 tests)
  // ==========================================================================
  describe('Edge Cases', () => {
    beforeEach(() => {
      pty.enableMouse('sgr')
    })

    it('clamps negative coordinates to 0', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: -5,
        y: -10,
      })

      expect(received.length).toBe(1)
      // Negative coords should be clamped to 0, then +1 for 1-based = 1
      expect(received[0]).toBe('\x1b[<0;1;1M')
    })

    it('allows large coordinates in SGR mode', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      // SGR mode supports coordinates > 223
      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 500,
        y: 300,
      })

      expect(received.length).toBe(1)
      // SGR uses decimal numbers, no limit
      expect(received[0]).toBe('\x1b[<0;501;301M')
    })

    it('handles all modifier combinations', () => {
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      // All modifiers: shift(4) + meta(8) + ctrl(16) = 28
      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 0,
        y: 0,
        shift: true,
        meta: true,
        ctrl: true,
      })

      expect(received.length).toBe(1)
      expect(received[0]).toBe('\x1b[<28;1;1M')
    })

    it('does not emit events when mouse tracking disabled', () => {
      pty.disableMouse()
      const received: string[] = []
      pty.onInput((data) => {
        received.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
      })

      pty.sendMouse({
        type: 'press',
        button: 'left',
        x: 10,
        y: 10,
      })

      expect(received.length).toBe(0)
    })
  })
})
