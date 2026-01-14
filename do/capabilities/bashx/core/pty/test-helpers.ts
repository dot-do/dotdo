/**
 * PTY Test Helpers
 *
 * Helper functions for building ANSI escape sequences in tests.
 * These make tests more readable and less error-prone than using
 * raw escape codes.
 *
 * @packageDocumentation
 */

import { CSI, OSC, ESC, SGR, DECModes, CSICommands, ESCCommands } from './constants.js'

// ============================================================================
// CSI Sequence Builders
// ============================================================================

/**
 * Build a CSI sequence string
 *
 * @param command - The command character (e.g., 'A' for cursor up)
 * @param params - Numeric parameters (e.g., [5] for "move 5 times")
 * @param privateMarker - Optional private marker (e.g., '?' for DEC modes)
 *
 * @example
 * ```typescript
 * buildCSI('H', [10, 20])     // '\x1b[10;20H' - move to row 10, col 20
 * buildCSI('m', [1, 31])      // '\x1b[1;31m' - bold red
 * buildCSI('h', [25], '?')    // '\x1b[?25h' - show cursor
 * ```
 */
export function buildCSI(
  command: string,
  params: number[] = [],
  privateMarker?: string
): string {
  const marker = privateMarker ?? ''
  const paramStr = params.join(';')
  return `${CSI}${marker}${paramStr}${command}`
}

/**
 * Build a cursor movement sequence
 */
export const cursor = {
  /** Move cursor up n rows */
  up: (n = 1) => buildCSI(CSICommands.CUU, [n]),
  /** Move cursor down n rows */
  down: (n = 1) => buildCSI(CSICommands.CUD, [n]),
  /** Move cursor forward (right) n columns */
  forward: (n = 1) => buildCSI(CSICommands.CUF, [n]),
  /** Move cursor backward (left) n columns */
  backward: (n = 1) => buildCSI(CSICommands.CUB, [n]),
  /** Move cursor to next line (column 1 of n lines down) */
  nextLine: (n = 1) => buildCSI(CSICommands.CNL, [n]),
  /** Move cursor to previous line (column 1 of n lines up) */
  prevLine: (n = 1) => buildCSI(CSICommands.CPL, [n]),
  /** Move cursor to column n */
  column: (n: number) => buildCSI(CSICommands.CHA, [n]),
  /** Move cursor to row, column (1-based) */
  position: (row: number, col: number) => buildCSI(CSICommands.CUP, [row, col]),
  /** Move cursor to row (1-based), keep column */
  row: (n: number) => buildCSI(CSICommands.VPA, [n]),
  /** Save cursor position */
  save: () => buildCSI(CSICommands.SCP),
  /** Restore cursor position */
  restore: () => buildCSI(CSICommands.RCP),
  /** Show cursor */
  show: () => buildCSI(CSICommands.DECSET, [DECModes.DECTCEM], '?'),
  /** Hide cursor */
  hide: () => buildCSI(CSICommands.DECRST, [DECModes.DECTCEM], '?'),
  /** Move to home position (1,1) */
  home: () => buildCSI(CSICommands.CUP),
}

/**
 * Build erase sequences
 */
export const erase = {
  /** Erase from cursor to end of screen */
  toEndOfScreen: () => buildCSI(CSICommands.ED, [0]),
  /** Erase from start of screen to cursor */
  toStartOfScreen: () => buildCSI(CSICommands.ED, [1]),
  /** Erase entire screen */
  screen: () => buildCSI(CSICommands.ED, [2]),
  /** Erase screen and scrollback (xterm extension) */
  screenAndScrollback: () => buildCSI(CSICommands.ED, [3]),
  /** Erase from cursor to end of line */
  toEndOfLine: () => buildCSI(CSICommands.EL, [0]),
  /** Erase from start of line to cursor */
  toStartOfLine: () => buildCSI(CSICommands.EL, [1]),
  /** Erase entire line */
  line: () => buildCSI(CSICommands.EL, [2]),
}

/**
 * Build scroll sequences
 */
export const scroll = {
  /** Scroll up n lines */
  up: (n = 1) => buildCSI(CSICommands.SU, [n]),
  /** Scroll down n lines */
  down: (n = 1) => buildCSI(CSICommands.SD, [n]),
  /** Set scroll region (1-based, inclusive) */
  setRegion: (top: number, bottom: number) => buildCSI(CSICommands.DECSTBM, [top, bottom]),
  /** Reset scroll region to full screen */
  resetRegion: () => buildCSI(CSICommands.DECSTBM),
}

/**
 * Build insert/delete sequences
 */
export const edit = {
  /** Insert n blank characters at cursor */
  insertChars: (n = 1) => buildCSI(CSICommands.ICH, [n]),
  /** Delete n characters at cursor */
  deleteChars: (n = 1) => buildCSI(CSICommands.DCH, [n]),
  /** Insert n blank lines at cursor */
  insertLines: (n = 1) => buildCSI(CSICommands.IL, [n]),
  /** Delete n lines at cursor */
  deleteLines: (n = 1) => buildCSI(CSICommands.DL, [n]),
}

// ============================================================================
// SGR (Colors and Attributes) Builders
// ============================================================================

/**
 * Build an SGR sequence for setting colors and attributes
 */
export function buildSGR(...codes: number[]): string {
  return buildCSI(CSICommands.SGR, codes)
}

/**
 * Build color and attribute sequences
 */
export const style = {
  /** Reset all attributes */
  reset: () => buildSGR(SGR.RESET),
  /** Bold text */
  bold: () => buildSGR(SGR.BOLD),
  /** Dim text */
  dim: () => buildSGR(SGR.DIM),
  /** Italic text */
  italic: () => buildSGR(SGR.ITALIC),
  /** Underlined text */
  underline: () => buildSGR(SGR.UNDERLINE),
  /** Blinking text */
  blink: () => buildSGR(SGR.BLINK_SLOW),
  /** Inverse video (swap fg/bg) */
  inverse: () => buildSGR(SGR.INVERSE),
  /** Hidden text */
  hidden: () => buildSGR(SGR.HIDDEN),
  /** Strikethrough text */
  strikethrough: () => buildSGR(SGR.STRIKETHROUGH),

  // Standard foreground colors
  /** Black foreground */
  fgBlack: () => buildSGR(SGR.FG_BLACK),
  /** Red foreground */
  fgRed: () => buildSGR(SGR.FG_RED),
  /** Green foreground */
  fgGreen: () => buildSGR(SGR.FG_GREEN),
  /** Yellow foreground */
  fgYellow: () => buildSGR(SGR.FG_YELLOW),
  /** Blue foreground */
  fgBlue: () => buildSGR(SGR.FG_BLUE),
  /** Magenta foreground */
  fgMagenta: () => buildSGR(SGR.FG_MAGENTA),
  /** Cyan foreground */
  fgCyan: () => buildSGR(SGR.FG_CYAN),
  /** White foreground */
  fgWhite: () => buildSGR(SGR.FG_WHITE),
  /** Default foreground */
  fgDefault: () => buildSGR(SGR.FG_DEFAULT),

  // Standard background colors
  /** Black background */
  bgBlack: () => buildSGR(SGR.BG_BLACK),
  /** Red background */
  bgRed: () => buildSGR(SGR.BG_RED),
  /** Green background */
  bgGreen: () => buildSGR(SGR.BG_GREEN),
  /** Yellow background */
  bgYellow: () => buildSGR(SGR.BG_YELLOW),
  /** Blue background */
  bgBlue: () => buildSGR(SGR.BG_BLUE),
  /** Magenta background */
  bgMagenta: () => buildSGR(SGR.BG_MAGENTA),
  /** Cyan background */
  bgCyan: () => buildSGR(SGR.BG_CYAN),
  /** White background */
  bgWhite: () => buildSGR(SGR.BG_WHITE),
  /** Default background */
  bgDefault: () => buildSGR(SGR.BG_DEFAULT),

  // Bright foreground colors
  /** Bright black (gray) foreground */
  fgBrightBlack: () => buildSGR(SGR.FG_BRIGHT_BLACK),
  /** Bright red foreground */
  fgBrightRed: () => buildSGR(SGR.FG_BRIGHT_RED),
  /** Bright green foreground */
  fgBrightGreen: () => buildSGR(SGR.FG_BRIGHT_GREEN),
  /** Bright yellow foreground */
  fgBrightYellow: () => buildSGR(SGR.FG_BRIGHT_YELLOW),
  /** Bright blue foreground */
  fgBrightBlue: () => buildSGR(SGR.FG_BRIGHT_BLUE),
  /** Bright magenta foreground */
  fgBrightMagenta: () => buildSGR(SGR.FG_BRIGHT_MAGENTA),
  /** Bright cyan foreground */
  fgBrightCyan: () => buildSGR(SGR.FG_BRIGHT_CYAN),
  /** Bright white foreground */
  fgBrightWhite: () => buildSGR(SGR.FG_BRIGHT_WHITE),

  // Bright background colors
  /** Bright black (gray) background */
  bgBrightBlack: () => buildSGR(SGR.BG_BRIGHT_BLACK),
  /** Bright red background */
  bgBrightRed: () => buildSGR(SGR.BG_BRIGHT_RED),
  /** Bright green background */
  bgBrightGreen: () => buildSGR(SGR.BG_BRIGHT_GREEN),
  /** Bright yellow background */
  bgBrightYellow: () => buildSGR(SGR.BG_BRIGHT_YELLOW),
  /** Bright blue background */
  bgBrightBlue: () => buildSGR(SGR.BG_BRIGHT_BLUE),
  /** Bright magenta background */
  bgBrightMagenta: () => buildSGR(SGR.BG_BRIGHT_MAGENTA),
  /** Bright cyan background */
  bgBrightCyan: () => buildSGR(SGR.BG_BRIGHT_CYAN),
  /** Bright white background */
  bgBrightWhite: () => buildSGR(SGR.BG_BRIGHT_WHITE),

  /** 256-color foreground (palette index 0-255) */
  fg256: (n: number) => buildSGR(SGR.FG_EXTENDED, SGR.COLOR_256, n),
  /** 256-color background (palette index 0-255) */
  bg256: (n: number) => buildSGR(SGR.BG_EXTENDED, SGR.COLOR_256, n),
  /** RGB foreground */
  fgRGB: (r: number, g: number, b: number) => buildSGR(SGR.FG_EXTENDED, SGR.COLOR_RGB, r, g, b),
  /** RGB background */
  bgRGB: (r: number, g: number, b: number) => buildSGR(SGR.BG_EXTENDED, SGR.COLOR_RGB, r, g, b),

  /**
   * Build a combined style string
   * @example style.combine(style.bold(), style.fgRed()) // Bold red text
   */
  combine: (...styles: string[]) => styles.join(''),
}

// ============================================================================
// OSC Sequence Builders
// ============================================================================

/**
 * Build an OSC sequence
 *
 * @param command - OSC command number
 * @param params - String parameters separated by ';'
 * @param terminator - Sequence terminator (default: BEL)
 */
export function buildOSC(
  command: number,
  params: string[] = [],
  terminator: string = '\x07'
): string {
  const paramStr = [command.toString(), ...params].join(';')
  return `${OSC}${paramStr}${terminator}`
}

/**
 * Build title and window control sequences
 */
export const osc = {
  /** Set window title and icon name */
  setTitle: (title: string) => buildOSC(0, [title]),
  /** Set icon name only */
  setIconName: (name: string) => buildOSC(1, [name]),
  /** Set window title only */
  setWindowTitle: (title: string) => buildOSC(2, [title]),
}

// ============================================================================
// Escape Sequence Builders
// ============================================================================

/**
 * Build a simple escape sequence
 */
export function buildESC(command: string, intermediates: string = ''): string {
  return `${ESC}${intermediates}${command}`
}

/**
 * Build escape sequences
 */
export const esc = {
  /** Save cursor position (DECSC) */
  saveCursor: () => buildESC(ESCCommands.DECSC),
  /** Restore cursor position (DECRC) */
  restoreCursor: () => buildESC(ESCCommands.DECRC),
  /** Reverse index (move cursor up, scroll if at top) */
  reverseIndex: () => buildESC(ESCCommands.RI),
  /** Reset terminal to initial state */
  reset: () => buildESC(ESCCommands.RIS),
  /** Index (move cursor down, scroll if at bottom) */
  index: () => buildESC(ESCCommands.IND),
  /** Next line (move to start of next line) */
  nextLine: () => buildESC(ESCCommands.NEL),
  /** Set tab stop at current column */
  setTabStop: () => buildESC(ESCCommands.HTS),
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wrap text with style and reset
 *
 * @example
 * ```typescript
 * wrap('Hello', style.bold(), style.fgRed())
 * // Returns: '\x1b[1m\x1b[31mHello\x1b[0m'
 * ```
 */
export function wrap(text: string, ...styles: string[]): string {
  return `${styles.join('')}${text}${style.reset()}`
}

/**
 * Build a sequence that moves cursor, writes text, then restores cursor
 */
export function writeAt(row: number, col: number, text: string): string {
  return `${cursor.save()}${cursor.position(row, col)}${text}${cursor.restore()}`
}

/**
 * Build a sequence that clears screen and moves cursor home
 */
export function clearScreen(): string {
  return `${erase.screen()}${cursor.home()}`
}

/**
 * Build a sequence that clears screen, scrollback, and moves cursor home
 */
export function clearAll(): string {
  return `${erase.screenAndScrollback()}${cursor.home()}`
}

/**
 * Convert escape sequence string to readable format for debugging
 *
 * @example
 * ```typescript
 * prettifySequence('\x1b[31m')
 * // Returns: 'ESC[31m'
 * ```
 */
export function prettifySequence(seq: string): string {
  return seq
    .replace(/\x1b/g, 'ESC')
    .replace(/\x07/g, 'BEL')
    .replace(/\x08/g, 'BS')
    .replace(/\x09/g, 'TAB')
    .replace(/\x0a/g, 'LF')
    .replace(/\x0d/g, 'CR')
    .replace(/\x7f/g, 'DEL')
}

/**
 * Parse a sequence string into components for debugging
 */
export function parseSequenceDebug(seq: string): {
  type: 'csi' | 'osc' | 'esc' | 'unknown'
  raw: string
  pretty: string
  components?: {
    command?: string
    params?: number[]
    privateMarker?: string
  }
} {
  const pretty = prettifySequence(seq)

  if (seq.startsWith('\x1b[')) {
    // CSI sequence
    const match = seq.match(/^\x1b\[([?>=<])?([0-9;]*)([A-Za-z@`])$/)
    if (match) {
      const [, privateMarker, paramsStr, command] = match
      const params = paramsStr ? paramsStr.split(';').map(Number) : []
      return {
        type: 'csi',
        raw: seq,
        pretty,
        components: {
          command,
          params,
          privateMarker,
        },
      }
    }
  } else if (seq.startsWith('\x1b]')) {
    // OSC sequence
    return {
      type: 'osc',
      raw: seq,
      pretty,
    }
  } else if (seq.startsWith('\x1b')) {
    // Simple escape sequence
    return {
      type: 'esc',
      raw: seq,
      pretty,
      components: {
        command: seq.slice(1),
      },
    }
  }

  return {
    type: 'unknown',
    raw: seq,
    pretty,
  }
}
