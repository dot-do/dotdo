/**
 * Virtual PTY Types
 *
 * Type definitions for the VirtualPTY terminal emulation layer.
 * Enables TUI frameworks like React Ink to run in headless environments.
 *
 * @packageDocumentation
 */

// ============================================================================
// Branded Types for Type Safety
// ============================================================================

/**
 * Branded type helper - creates nominal types that are structurally
 * incompatible with plain values despite having the same underlying type.
 *
 * @example
 * ```typescript
 * type Row = Brand<number, 'Row'>
 * type Col = Brand<number, 'Col'>
 *
 * const row: Row = 5 as Row
 * const col: Col = 10 as Col
 *
 * // Type error: can't assign Row to Col
 * const wrong: Col = row
 * ```
 */
declare const __brand: unique symbol
export type Brand<T, B> = T & { [__brand]: B }

/**
 * Row index in the terminal buffer (0-based)
 */
export type Row = Brand<number, 'Row'>

/**
 * Column index in the terminal buffer (0-based)
 */
export type Col = Brand<number, 'Col'>

/**
 * SGR (Select Graphic Rendition) code
 */
export type SGRCode = Brand<number, 'SGRCode'>

/**
 * DEC private mode number
 */
export type DECMode = Brand<number, 'DECMode'>

/**
 * OSC (Operating System Command) code
 */
export type OSCCode = Brand<number, 'OSCCode'>

/**
 * Byte value (0-255)
 */
export type Byte = Brand<number, 'Byte'>

/**
 * Create a Row value
 */
export function row(n: number): Row {
  return n as Row
}

/**
 * Create a Col value
 */
export function col(n: number): Col {
  return n as Col
}

/**
 * Create an SGRCode value
 */
export function sgrCode(n: number): SGRCode {
  return n as SGRCode
}

/**
 * Create a DECMode value
 */
export function decMode(n: number): DECMode {
  return n as DECMode
}

/**
 * Create an OSCCode value
 */
export function oscCode(n: number): OSCCode {
  return n as OSCCode
}

/**
 * Create a Byte value
 */
export function byte(n: number): Byte {
  if (n < 0 || n > 255) {
    throw new RangeError(`Byte value must be 0-255, got ${n}`)
  }
  return n as Byte
}

// ============================================================================
// Screen Buffer Types
// ============================================================================

/**
 * ANSI color codes (0-255 for 256-color mode)
 * Standard colors: 0-15
 * 216 color cube: 16-231
 * Grayscale: 232-255
 */
export type ColorCode = number

/**
 * RGB color representation
 */
export interface RGBColor {
  r: number
  g: number
  b: number
}

/**
 * Color specification - either a code or RGB value
 */
export type Color = ColorCode | RGBColor | 'default'

/**
 * Text attributes for a cell
 */
export interface CellAttributes {
  /** Foreground color */
  fg: Color
  /** Background color */
  bg: Color
  /** Bold/bright text */
  bold: boolean
  /** Dim/faint text */
  dim: boolean
  /** Italic text */
  italic: boolean
  /** Underlined text */
  underline: boolean
  /** Blinking text */
  blink: boolean
  /** Inverse video (swap fg/bg) */
  inverse: boolean
  /** Hidden/invisible text */
  hidden: boolean
  /** Strikethrough text */
  strikethrough: boolean
}

/**
 * A single character cell in the screen buffer
 */
export interface Cell {
  /** The character (single Unicode codepoint or empty string for unset) */
  char: string
  /** Character width (0 for continuation cells in wide chars, 1-2 normally) */
  width: number
  /** Display attributes */
  attrs: CellAttributes
}

/**
 * Cursor state
 */
export interface CursorState {
  /** Column position (0-based) */
  x: number
  /** Row position (0-based) */
  y: number
  /** Whether cursor is visible */
  visible: boolean
  /** Cursor style */
  style: 'block' | 'underline' | 'bar'
  /** Whether cursor is blinking */
  blinking: boolean
}

/**
 * Screen buffer representing terminal display state
 */
export interface ScreenBuffer {
  /** Number of columns */
  cols: number
  /** Number of rows */
  rows: number
  /** 2D array of cells [row][col] */
  cells: Cell[][]
  /** Cursor state */
  cursor: CursorState
  /** Current default attributes for new characters */
  defaultAttrs: CellAttributes
  /** Scroll region top row (0-based, inclusive) */
  scrollTop: number
  /** Scroll region bottom row (0-based, inclusive) */
  scrollBottom: number
}

// ============================================================================
// Parser State Machine Types
// ============================================================================

/**
 * ANSI parser states based on VT500 state machine
 * @see https://vt100.net/emu/dec_ansi_parser
 */
export type ParserState =
  | 'ground'
  | 'escape'
  | 'escape_intermediate'
  | 'csi_entry'
  | 'csi_param'
  | 'csi_intermediate'
  | 'csi_ignore'
  | 'dcs_entry'
  | 'dcs_param'
  | 'dcs_intermediate'
  | 'dcs_passthrough'
  | 'dcs_ignore'
  | 'osc_string'
  | 'sos_pm_apc_string'

/**
 * Parsed ANSI escape sequence
 */
export interface ParsedSequence {
  /** Type of sequence */
  type: 'csi' | 'esc' | 'osc' | 'dcs' | 'control'
  /** Final character (command) */
  finalChar: string
  /** Private marker (e.g., '?' in CSI ? 25 h) */
  privateMarker?: string
  /** Intermediate characters */
  intermediates: string
  /** Numeric parameters */
  params: number[]
  /** Raw sequence string */
  raw: string
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Screen change event - emitted when display updates
 */
export interface ScreenChangeEvent {
  /** Type of change */
  type: 'write' | 'resize' | 'scroll' | 'clear' | 'cursor'
  /** Affected region (if applicable) */
  region?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** Timestamp of the change */
  timestamp: number
}

/**
 * Bell event - emitted when BEL character received
 */
export interface BellEvent {
  type: 'bell'
  timestamp: number
}

/**
 * Title change event - emitted when OSC sets title
 */
export interface TitleChangeEvent {
  type: 'title'
  title: string
  timestamp: number
}

/**
 * Union type of all PTY events
 */
export type PTYEvent = ScreenChangeEvent | BellEvent | TitleChangeEvent

// ============================================================================
// Input Types
// ============================================================================

/**
 * Key names for special keys
 */
export type SpecialKey =
  | 'return'
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'insert'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
  | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12'

/**
 * Key event for sendKey() method
 *
 * Compatible with React Ink's useInput hook key events
 */
export interface KeyEvent {
  /** The key pressed (single character or special key name) */
  key: string | SpecialKey
  /** Ctrl modifier */
  ctrl?: boolean
  /** Alt/Meta modifier */
  meta?: boolean
  /** Shift modifier */
  shift?: boolean
}

// ============================================================================
// Mouse Event Types
// ============================================================================

/**
 * Mouse button identifiers
 *
 * - 'left', 'middle', 'right' for standard buttons
 * - 'wheelUp', 'wheelDown' for scroll wheel
 * - 'none' for move events without a button pressed
 */
export type MouseButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'wheelUp'
  | 'wheelDown'
  | 'none'

/**
 * Mouse event types
 *
 * - 'press': Button pressed down
 * - 'release': Button released
 * - 'move': Mouse moved (with or without button held)
 * - 'wheel': Scroll wheel event
 */
export type MouseEventType = 'press' | 'release' | 'move' | 'wheel'

/**
 * Mouse tracking modes following xterm protocol
 *
 * - 'normal': X10 compatible mode (CSI M Cb Cx Cy)
 * - 'sgr': SGR extended mode (CSI < Pb ; Px ; Py M/m) - supports large coordinates
 */
export type MouseMode = 'normal' | 'sgr'

/**
 * Mouse event for sendMouse() method
 *
 * Follows xterm mouse protocol for TUI application compatibility.
 *
 * @example
 * ```typescript
 * // Left click at position (10, 5)
 * pty.sendMouse({ type: 'press', button: 'left', x: 10, y: 5 })
 *
 * // Scroll wheel up with Shift held
 * pty.sendMouse({ type: 'wheel', button: 'wheelUp', x: 20, y: 10, shift: true })
 *
 * // Mouse move with left button held (drag)
 * pty.sendMouse({ type: 'move', button: 'left', x: 15, y: 8 })
 * ```
 */
export interface MouseEvent {
  /** Type of mouse event */
  type: MouseEventType
  /** Mouse button involved */
  button: MouseButton
  /** X coordinate (0-based column) */
  x: number
  /** Y coordinate (0-based row) */
  y: number
  /** Shift modifier held */
  shift?: boolean
  /** Alt/Meta modifier held */
  meta?: boolean
  /** Ctrl modifier held */
  ctrl?: boolean
}

// ============================================================================
// Callback Types
// ============================================================================

/**
 * Callback for raw data streaming
 */
export type DataCallback = (data: Uint8Array | string) => void

/**
 * Callback for screen change events
 */
export type ScreenChangeCallback = (event: ScreenChangeEvent, buffer: ScreenBuffer) => void

/**
 * Callback for parsed sequences (useful for debugging/passthrough)
 */
export type SequenceCallback = (sequence: ParsedSequence) => void

/**
 * Callback for PTY events
 */
export type EventCallback = (event: PTYEvent) => void

/**
 * Callback for input data (simulated stdin)
 */
export type InputCallback = (data: Uint8Array | string) => void

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * VirtualPTY configuration options
 */
export interface VirtualPTYOptions {
  /** Number of columns (default: 80) */
  cols?: number
  /** Number of rows (default: 24) */
  rows?: number
  /** Whether to track full screen buffer state (default: true) */
  trackBuffer?: boolean
  /** Maximum scrollback lines (default: 1000, 0 to disable) */
  scrollback?: number
  /** Terminal type to report (default: 'xterm-256color') */
  termType?: string
  /** Initial environment variables */
  env?: Record<string, string>
}

/**
 * PTY info returned by getInfo()
 */
export interface PTYInfo {
  /** Number of columns */
  cols: number
  /** Number of rows */
  rows: number
  /** Terminal type */
  termType: string
  /** Whether PTY is a TTY (always true for VirtualPTY) */
  isTTY: true
  /** Total bytes written */
  bytesWritten: number
  /** Total sequences parsed */
  sequencesParsed: number
}
