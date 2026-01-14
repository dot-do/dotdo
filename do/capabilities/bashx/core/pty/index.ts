/**
 * @dotdo/bashx PTY Module
 *
 * Virtual PTY implementation for headless terminal emulation.
 * Enables TUI frameworks like React Ink to run in Durable Objects
 * and other headless JavaScript environments.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { VirtualPTY } from '@dotdo/bashx/pty'
 *
 * // Create a virtual terminal
 * const pty = new VirtualPTY({ cols: 80, rows: 24 })
 *
 * // Listen for screen changes (for streaming to clients)
 * pty.onScreenChange((event, buffer) => {
 *   // Send buffer state to connected clients
 *   broadcastToClients(buffer.toString())
 * })
 *
 * // Write data to the terminal
 * pty.write('\x1b[31mHello\x1b[0m World!\n')
 *
 * // Get environment variables for child processes
 * const env = pty.getEnvironment()
 * // { TERM: 'xterm-256color', COLUMNS: '80', LINES: '24', ... }
 * ```
 */

// ============================================================================
// Main Exports
// ============================================================================

export { VirtualPTY } from './virtual-pty.js'
export { ANSIParser } from './parser.js'
export { TerminalBuffer, createDefaultAttributes, createEmptyCell, createDefaultCursor } from './buffer.js'

// ============================================================================
// React Ink Adapter Exports
// ============================================================================

export {
  InkAdapter,
  InkWriteStream,
  InkReadStream,
  createInkStreams,
  createInkStdout,
  createInkStdin,
  createInkStderr,
} from './ink-adapter.js'

export type {
  InkAdapterOptions,
  InkRenderOptions,
  InkStreams,
} from './ink-adapter.js'

// ============================================================================
// Constants Exports
// ============================================================================

export {
  // Control characters
  NUL, SOH, STX, ETX, EOT, ENQ, ACK, BEL, BS, HT, LF, VT, FF, CR,
  SO, SI, DLE, DC1, DC2, DC3, DC4, NAK, SYN, ETB, CAN, EM, SUB, ESC,
  FS, GS, RS, US, DEL,
  // 8-bit C1 controls
  DCS_8BIT, ST_8BIT, OSC_8BIT, PM_8BIT, APC_8BIT, SOS_8BIT, CSI_8BIT,
  // 7-bit sequence introducers
  CSI, OSC, DCS, ST, SOS, PM, APC,
  // Command constants
  CSICommands, ESCCommands, OSCCommands, DECModes, SGR,
  // Byte ranges
  ByteRanges, SpecialChars,
} from './constants.js'

// ============================================================================
// Handler Registry Exports
// ============================================================================

export {
  SequenceHandlerRegistry,
  createDefaultRegistry,
} from './handlers.js'

export type {
  HandlerContext,
  CSIHandler,
  ESCHandler,
  PrivateCSIHandler,
  OSCHandler,
  SGRHandler,
} from './handlers.js'

// ============================================================================
// Test Helper Exports
// ============================================================================

export {
  buildCSI,
  buildSGR,
  buildOSC,
  buildESC,
  cursor,
  erase,
  scroll,
  edit,
  style,
  osc,
  esc,
  wrap,
  writeAt,
  clearScreen,
  clearAll,
  prettifySequence,
  parseSequenceDebug,
} from './test-helpers.js'

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Branded types
  Brand,
  Row,
  Col,
  SGRCode,
  DECMode,
  OSCCode,
  Byte,

  // Branded type constructors
  // (re-exported as values above, types here for completeness)

  // Core configuration
  VirtualPTYOptions,
  PTYInfo,

  // Screen buffer types
  ScreenBuffer,
  Cell,
  CellAttributes,
  CursorState,
  Color,
  ColorCode,
  RGBColor,

  // Parser types
  ParserState,
  ParsedSequence,

  // Event types
  PTYEvent,
  ScreenChangeEvent,
  BellEvent,
  TitleChangeEvent,

  // Input types
  SpecialKey,
  KeyEvent,
  MouseButton,
  MouseEventType,
  MouseMode,
  MouseEvent,

  // Callback types
  DataCallback,
  ScreenChangeCallback,
  SequenceCallback,
  EventCallback,
  InputCallback,
} from './types.js'

// Re-export branded type constructors as values
export { row, col, sgrCode, decMode, oscCode, byte } from './types.js'
