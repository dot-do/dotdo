/**
 * Sequence Handler Registry
 *
 * This module provides a registry pattern for handling ANSI escape sequences.
 * Handlers can be registered for specific sequence types and commands,
 * making the code more modular and extensible.
 *
 * @packageDocumentation
 */

import type { ParsedSequence } from './types.js'
import type { TerminalBuffer } from './buffer.js'
import { CSICommands, SGR, DECModes } from './constants.js'

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Context provided to sequence handlers
 */
export interface HandlerContext {
  /** The terminal buffer to operate on */
  buffer: TerminalBuffer
  /** Emit a screen change event */
  emitScreenChange: (type: 'write' | 'scroll' | 'clear' | 'cursor') => void
  /** Emit a PTY event */
  emitEvent: (event: { type: string; timestamp: number; [key: string]: unknown }) => void
  /** Set terminal title */
  setTitle: (title: string) => void
}

/**
 * Handler function for a CSI sequence
 */
export type CSIHandler = (
  params: number[],
  context: HandlerContext,
  sequence: ParsedSequence
) => void

/**
 * Handler function for an escape sequence
 */
export type ESCHandler = (
  context: HandlerContext,
  sequence: ParsedSequence
) => void

/**
 * Handler function for private CSI sequences (with ? prefix)
 */
export type PrivateCSIHandler = (
  mode: number,
  enable: boolean,
  context: HandlerContext,
  sequence: ParsedSequence
) => void

/**
 * Handler function for OSC sequences
 */
export type OSCHandler = (
  params: string[],
  context: HandlerContext
) => void

/**
 * Handler function for SGR (color/attribute) codes
 */
export type SGRHandler = (
  params: number[],
  index: number,
  context: HandlerContext
) => number // Returns new index after consuming parameters

// ============================================================================
// Handler Registry
// ============================================================================

/**
 * Registry for sequence handlers.
 *
 * This class provides a way to register and lookup handlers for different
 * ANSI escape sequences. It supports:
 * - CSI sequences (ESC [ ... command)
 * - Escape sequences (ESC command)
 * - Private CSI sequences (ESC [ ? ... command)
 * - OSC sequences (ESC ] ... BEL)
 * - SGR codes (color and attribute codes)
 *
 * @example
 * ```typescript
 * const registry = new SequenceHandlerRegistry()
 *
 * // Register a handler for cursor up (CSI A)
 * registry.registerCSI('A', (params, ctx) => {
 *   ctx.buffer.cursorUp(params[0] || 1)
 * })
 *
 * // Use the handler
 * const handler = registry.getCSI('A')
 * if (handler) {
 *   handler([5], context, sequence)
 * }
 * ```
 */
export class SequenceHandlerRegistry {
  private csiHandlers = new Map<string, CSIHandler>()
  private escHandlers = new Map<string, ESCHandler>()
  private privateCSIHandlers = new Map<number, PrivateCSIHandler>()
  private oscHandlers = new Map<number, OSCHandler>()
  private sgrHandlers = new Map<number, SGRHandler>()

  /**
   * Register a handler for a CSI sequence command
   */
  registerCSI(command: string, handler: CSIHandler): this {
    this.csiHandlers.set(command, handler)
    return this
  }

  /**
   * Register a handler for an escape sequence command
   */
  registerESC(command: string, handler: ESCHandler): this {
    this.escHandlers.set(command, handler)
    return this
  }

  /**
   * Register a handler for a private CSI mode
   */
  registerPrivateCSI(mode: number, handler: PrivateCSIHandler): this {
    this.privateCSIHandlers.set(mode, handler)
    return this
  }

  /**
   * Register a handler for an OSC command
   */
  registerOSC(command: number, handler: OSCHandler): this {
    this.oscHandlers.set(command, handler)
    return this
  }

  /**
   * Register a handler for an SGR code
   */
  registerSGR(code: number, handler: SGRHandler): this {
    this.sgrHandlers.set(code, handler)
    return this
  }

  /**
   * Get a CSI handler by command character
   */
  getCSI(command: string): CSIHandler | undefined {
    return this.csiHandlers.get(command)
  }

  /**
   * Get an escape sequence handler by command character
   */
  getESC(command: string): ESCHandler | undefined {
    return this.escHandlers.get(command)
  }

  /**
   * Get a private CSI handler by mode number
   */
  getPrivateCSI(mode: number): PrivateCSIHandler | undefined {
    return this.privateCSIHandlers.get(mode)
  }

  /**
   * Get an OSC handler by command number
   */
  getOSC(command: number): OSCHandler | undefined {
    return this.oscHandlers.get(command)
  }

  /**
   * Get an SGR handler by code
   */
  getSGR(code: number): SGRHandler | undefined {
    return this.sgrHandlers.get(code)
  }

  /**
   * Check if a CSI handler is registered
   */
  hasCSI(command: string): boolean {
    return this.csiHandlers.has(command)
  }

  /**
   * Check if an escape handler is registered
   */
  hasESC(command: string): boolean {
    return this.escHandlers.has(command)
  }

  /**
   * Check if a private CSI handler is registered
   */
  hasPrivateCSI(mode: number): boolean {
    return this.privateCSIHandlers.has(mode)
  }

  /**
   * Check if an OSC handler is registered
   */
  hasOSC(command: number): boolean {
    return this.oscHandlers.has(command)
  }

  /**
   * Check if an SGR handler is registered
   */
  hasSGR(code: number): boolean {
    return this.sgrHandlers.has(code)
  }

  /**
   * Unregister a CSI handler
   */
  unregisterCSI(command: string): boolean {
    return this.csiHandlers.delete(command)
  }

  /**
   * Unregister an escape handler
   */
  unregisterESC(command: string): boolean {
    return this.escHandlers.delete(command)
  }

  /**
   * Unregister a private CSI handler
   */
  unregisterPrivateCSI(mode: number): boolean {
    return this.privateCSIHandlers.delete(mode)
  }

  /**
   * Unregister an OSC handler
   */
  unregisterOSC(command: number): boolean {
    return this.oscHandlers.delete(command)
  }

  /**
   * Unregister an SGR handler
   */
  unregisterSGR(code: number): boolean {
    return this.sgrHandlers.delete(code)
  }

  /**
   * Clear all registered handlers
   */
  clear(): void {
    this.csiHandlers.clear()
    this.escHandlers.clear()
    this.privateCSIHandlers.clear()
    this.oscHandlers.clear()
    this.sgrHandlers.clear()
  }
}

// ============================================================================
// Default Handlers
// ============================================================================

/**
 * Create a registry with default handlers for common ANSI sequences.
 * This provides a standard implementation that can be customized.
 */
export function createDefaultRegistry(): SequenceHandlerRegistry {
  const registry = new SequenceHandlerRegistry()

  // ---- Cursor Movement ----
  registry.registerCSI(CSICommands.CUU, (params, ctx) => {
    ctx.buffer.cursorUp(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CUD, (params, ctx) => {
    ctx.buffer.cursorDown(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CUF, (params, ctx) => {
    ctx.buffer.cursorForward(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CUB, (params, ctx) => {
    ctx.buffer.cursorBackward(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CNL, (params, ctx) => {
    ctx.buffer.carriageReturn()
    ctx.buffer.cursorDown(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CPL, (params, ctx) => {
    ctx.buffer.carriageReturn()
    ctx.buffer.cursorUp(params[0] || 1)
  })

  registry.registerCSI(CSICommands.CHA, (params, ctx) => {
    ctx.buffer.moveCursor((params[0] || 1) - 1, ctx.buffer.cursor.y)
  })

  registry.registerCSI(CSICommands.CUP, (params, ctx) => {
    ctx.buffer.moveCursor((params[1] || 1) - 1, (params[0] || 1) - 1)
  })

  registry.registerCSI(CSICommands.HVP, (params, ctx) => {
    ctx.buffer.moveCursor((params[1] || 1) - 1, (params[0] || 1) - 1)
  })

  registry.registerCSI(CSICommands.VPA, (params, ctx) => {
    ctx.buffer.moveCursor(ctx.buffer.cursor.x, (params[0] || 1) - 1)
  })

  // ---- Erase Operations ----
  registry.registerCSI(CSICommands.ED, (params, ctx) => {
    const mode = params[0] ?? 0
    switch (mode) {
      case 0:
        ctx.buffer.eraseToEndOfScreen()
        break
      case 1:
        ctx.buffer.eraseToStartOfScreen()
        break
      case 2:
      case 3:
        ctx.buffer.eraseScreen()
        break
    }
  })

  registry.registerCSI(CSICommands.EL, (params, ctx) => {
    const mode = params[0] ?? 0
    switch (mode) {
      case 0:
        ctx.buffer.eraseToEndOfLine()
        break
      case 1:
        ctx.buffer.eraseToStartOfLine()
        break
      case 2:
        ctx.buffer.eraseLine()
        break
    }
  })

  // ---- Insert/Delete Operations ----
  registry.registerCSI(CSICommands.ICH, (params, ctx) => {
    ctx.buffer.insertChars(params[0] || 1)
  })

  registry.registerCSI(CSICommands.DCH, (params, ctx) => {
    ctx.buffer.deleteChars(params[0] || 1)
  })

  registry.registerCSI(CSICommands.IL, (params, ctx) => {
    ctx.buffer.insertLines(params[0] || 1)
  })

  registry.registerCSI(CSICommands.DL, (params, ctx) => {
    ctx.buffer.deleteLines(params[0] || 1)
  })

  // ---- Scroll Operations ----
  registry.registerCSI(CSICommands.SU, (params, ctx) => {
    ctx.buffer.scrollUp(params[0] || 1)
    ctx.emitScreenChange('scroll')
  })

  registry.registerCSI(CSICommands.SD, (params, ctx) => {
    ctx.buffer.scrollDown(params[0] || 1)
    ctx.emitScreenChange('scroll')
  })

  // ---- Scroll Region ----
  registry.registerCSI(CSICommands.DECSTBM, (params, ctx) => {
    const top = (params[0] || 1) - 1
    const bottom = (params[1] ?? ctx.buffer.rows) - 1
    ctx.buffer.setScrollRegion(top, bottom)
  })

  // ---- Cursor Save/Restore ----
  registry.registerCSI(CSICommands.SCP, (_params, ctx) => {
    ctx.buffer.saveCursor()
  })

  registry.registerCSI(CSICommands.RCP, (_params, ctx) => {
    ctx.buffer.restoreCursor()
  })

  // ---- Escape Sequences ----
  registry.registerESC('7', (ctx) => {
    ctx.buffer.saveCursor()
  })

  registry.registerESC('8', (ctx) => {
    ctx.buffer.restoreCursor()
  })

  registry.registerESC('M', (ctx) => {
    ctx.buffer.reverseLineFeed()
  })

  registry.registerESC('c', (ctx) => {
    ctx.buffer.eraseScreen()
    ctx.buffer.moveCursor(0, 0)
    ctx.buffer.resetAttributes()
    ctx.emitScreenChange('clear')
  })

  // ---- Private CSI Modes ----
  registry.registerPrivateCSI(DECModes.DECTCEM, (_mode, enable, ctx) => {
    ctx.buffer.setCursorVisible(enable)
    ctx.emitScreenChange('cursor')
  })

  // ---- OSC Commands ----
  registry.registerOSC(0, (params, ctx) => {
    if (params.length > 1) {
      ctx.setTitle(params.slice(1).join(';'))
    }
  })

  registry.registerOSC(1, (params, ctx) => {
    if (params.length > 1) {
      ctx.setTitle(params.slice(1).join(';'))
    }
  })

  registry.registerOSC(2, (params, ctx) => {
    if (params.length > 1) {
      ctx.setTitle(params.slice(1).join(';'))
    }
  })

  // ---- SGR Attribute Handlers ----

  // Reset
  registry.registerSGR(SGR.RESET, (_params, _i, ctx) => {
    ctx.buffer.resetAttributes()
    return 1
  })

  // Bold
  registry.registerSGR(SGR.BOLD, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('bold', true)
    return 1
  })

  // Dim
  registry.registerSGR(SGR.DIM, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('dim', true)
    return 1
  })

  // Italic
  registry.registerSGR(SGR.ITALIC, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('italic', true)
    return 1
  })

  // Underline
  registry.registerSGR(SGR.UNDERLINE, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('underline', true)
    return 1
  })

  // Blink
  registry.registerSGR(SGR.BLINK_SLOW, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('blink', true)
    return 1
  })

  // Inverse
  registry.registerSGR(SGR.INVERSE, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('inverse', true)
    return 1
  })

  // Hidden
  registry.registerSGR(SGR.HIDDEN, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('hidden', true)
    return 1
  })

  // Strikethrough
  registry.registerSGR(SGR.STRIKETHROUGH, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('strikethrough', true)
    return 1
  })

  // Reset bold/dim
  registry.registerSGR(SGR.NORMAL_INTENSITY, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('bold', false)
    ctx.buffer.setAttribute('dim', false)
    return 1
  })

  // Reset italic
  registry.registerSGR(SGR.NOT_ITALIC, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('italic', false)
    return 1
  })

  // Reset underline
  registry.registerSGR(SGR.NOT_UNDERLINE, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('underline', false)
    return 1
  })

  // Reset blink
  registry.registerSGR(SGR.NOT_BLINK, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('blink', false)
    return 1
  })

  // Reset inverse
  registry.registerSGR(SGR.NOT_INVERSE, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('inverse', false)
    return 1
  })

  // Reset hidden
  registry.registerSGR(SGR.NOT_HIDDEN, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('hidden', false)
    return 1
  })

  // Reset strikethrough
  registry.registerSGR(SGR.NOT_STRIKETHROUGH, (_params, _i, ctx) => {
    ctx.buffer.setAttribute('strikethrough', false)
    return 1
  })

  // Default foreground
  registry.registerSGR(SGR.FG_DEFAULT, (_params, _i, ctx) => {
    ctx.buffer.setForeground('default')
    return 1
  })

  // Default background
  registry.registerSGR(SGR.BG_DEFAULT, (_params, _i, ctx) => {
    ctx.buffer.setBackground('default')
    return 1
  })

  return registry
}
