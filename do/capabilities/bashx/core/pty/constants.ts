/**
 * ANSI Escape Sequence Constants
 *
 * This module contains all ANSI escape sequence constants, control character codes,
 * and SGR (Select Graphic Rendition) attribute codes used by the PTY implementation.
 *
 * @packageDocumentation
 */

// ============================================================================
// Control Characters (C0 Control Codes)
// ============================================================================

/** Null character */
export const NUL = 0x00
/** Start of Heading */
export const SOH = 0x01
/** Start of Text */
export const STX = 0x02
/** End of Text */
export const ETX = 0x03
/** End of Transmission */
export const EOT = 0x04
/** Enquiry */
export const ENQ = 0x05
/** Acknowledge */
export const ACK = 0x06
/** Bell - audible alert */
export const BEL = 0x07
/** Backspace - move cursor left */
export const BS = 0x08
/** Horizontal Tab - move to next tab stop */
export const HT = 0x09
/** Line Feed - move cursor down (newline) */
export const LF = 0x0a
/** Vertical Tab - move cursor down */
export const VT = 0x0b
/** Form Feed - clear screen / new page */
export const FF = 0x0c
/** Carriage Return - move cursor to column 0 */
export const CR = 0x0d
/** Shift Out */
export const SO = 0x0e
/** Shift In */
export const SI = 0x0f
/** Data Link Escape */
export const DLE = 0x10
/** Device Control 1 (XON) */
export const DC1 = 0x11
/** Device Control 2 */
export const DC2 = 0x12
/** Device Control 3 (XOFF) */
export const DC3 = 0x13
/** Device Control 4 */
export const DC4 = 0x14
/** Negative Acknowledge */
export const NAK = 0x15
/** Synchronous Idle */
export const SYN = 0x16
/** End of Transmission Block */
export const ETB = 0x17
/** Cancel - abort current sequence */
export const CAN = 0x18
/** End of Medium */
export const EM = 0x19
/** Substitute - abort current sequence */
export const SUB = 0x1a
/** Escape - start escape sequence */
export const ESC = 0x1b
/** File Separator */
export const FS = 0x1c
/** Group Separator */
export const GS = 0x1d
/** Record Separator */
export const RS = 0x1e
/** Unit Separator */
export const US = 0x1f
/** Delete */
export const DEL = 0x7f

// ============================================================================
// 8-bit C1 Control Codes
// ============================================================================

/** Device Control String (8-bit) */
export const DCS_8BIT = 0x90
/** String Terminator (8-bit) */
export const ST_8BIT = 0x9c
/** Operating System Command (8-bit) */
export const OSC_8BIT = 0x9d
/** Privacy Message (8-bit) */
export const PM_8BIT = 0x9e
/** Application Program Command (8-bit) */
export const APC_8BIT = 0x9f
/** Start of String (8-bit) */
export const SOS_8BIT = 0x98
/** Control Sequence Introducer (8-bit) */
export const CSI_8BIT = 0x9b

// ============================================================================
// Escape Sequence Introducers (7-bit equivalents)
// ============================================================================

/** Control Sequence Introducer: ESC [ */
export const CSI = '\x1b['
/** Operating System Command: ESC ] */
export const OSC = '\x1b]'
/** Device Control String: ESC P */
export const DCS = '\x1bP'
/** String Terminator: ESC \ */
export const ST = '\x1b\\'
/** Start of String: ESC X */
export const SOS = '\x1bX'
/** Privacy Message: ESC ^ */
export const PM = '\x1b^'
/** Application Program Command: ESC _ */
export const APC = '\x1b_'

// ============================================================================
// CSI Final Characters (Command Codes)
// ============================================================================

export const CSICommands = {
  /** Cursor Up */
  CUU: 'A',
  /** Cursor Down */
  CUD: 'B',
  /** Cursor Forward (Right) */
  CUF: 'C',
  /** Cursor Backward (Left) */
  CUB: 'D',
  /** Cursor Next Line */
  CNL: 'E',
  /** Cursor Previous Line */
  CPL: 'F',
  /** Cursor Horizontal Absolute */
  CHA: 'G',
  /** Cursor Position */
  CUP: 'H',
  /** Erase in Display */
  ED: 'J',
  /** Erase in Line */
  EL: 'K',
  /** Insert Line */
  IL: 'L',
  /** Delete Line */
  DL: 'M',
  /** Delete Character */
  DCH: 'P',
  /** Scroll Up */
  SU: 'S',
  /** Scroll Down */
  SD: 'T',
  /** Insert Character */
  ICH: '@',
  /** Vertical Position Absolute */
  VPA: 'd',
  /** Horizontal Vertical Position */
  HVP: 'f',
  /** Select Graphic Rendition */
  SGR: 'm',
  /** Device Status Report */
  DSR: 'n',
  /** Set Top and Bottom Margins */
  DECSTBM: 'r',
  /** Save Cursor Position */
  SCP: 's',
  /** Restore Cursor Position */
  RCP: 'u',
  /** DEC Private Mode Set */
  DECSET: 'h',
  /** DEC Private Mode Reset */
  DECRST: 'l',
} as const

// ============================================================================
// DEC Private Mode Codes (used with ? prefix)
// ============================================================================

export const DECModes = {
  /** Cursor Keys Mode (Application) */
  DECCKM: 1,
  /** ANSI/VT52 Mode */
  DECANM: 2,
  /** 132 Column Mode */
  DECCOLM: 3,
  /** Smooth Scroll */
  DECSCLM: 4,
  /** Reverse Video */
  DECSCNM: 5,
  /** Origin Mode */
  DECOM: 6,
  /** Auto Wrap Mode */
  DECAWM: 7,
  /** Auto Repeat */
  DECARM: 8,
  /** Cursor Visible (DECTCEM) */
  DECTCEM: 25,
  /** Mouse Tracking (X10) */
  MOUSE_X10: 9,
  /** Mouse Tracking (Normal) */
  MOUSE_VT200: 1000,
  /** Mouse Tracking (Highlight) */
  MOUSE_VT200_HIGHLIGHT: 1001,
  /** Mouse Tracking (Button Event) */
  MOUSE_BTN_EVENT: 1002,
  /** Mouse Tracking (Any Event) */
  MOUSE_ANY_EVENT: 1003,
  /** Focus Events */
  FOCUS_EVENT: 1004,
  /** UTF-8 Mouse Mode */
  MOUSE_UTF8: 1005,
  /** SGR Mouse Mode */
  MOUSE_SGR: 1006,
  /** Alternate Scroll Mode */
  ALTERNATE_SCROLL: 1007,
  /** Alternate Screen Buffer */
  ALTBUF: 47,
  /** Alternate Screen Buffer (with save/restore cursor) */
  ALTBUF_CURSOR: 1047,
  /** Save Cursor and Switch to Alternate Buffer */
  ALTBUF_SAVE: 1049,
  /** Bracketed Paste Mode */
  BRACKETED_PASTE: 2004,
} as const

// ============================================================================
// SGR (Select Graphic Rendition) Codes
// ============================================================================

export const SGR = {
  // Reset and Basic Attributes
  /** Reset all attributes to default */
  RESET: 0,
  /** Bold or increased intensity */
  BOLD: 1,
  /** Faint, decreased intensity, or dim */
  DIM: 2,
  /** Italic */
  ITALIC: 3,
  /** Underline */
  UNDERLINE: 4,
  /** Slow blink (less than 150 per minute) */
  BLINK_SLOW: 5,
  /** Rapid blink (150+ per minute) */
  BLINK_RAPID: 6,
  /** Reverse video (swap fg/bg) */
  INVERSE: 7,
  /** Conceal/hidden */
  HIDDEN: 8,
  /** Crossed-out/strikethrough */
  STRIKETHROUGH: 9,

  // Fonts (10-20)
  /** Primary (default) font */
  FONT_PRIMARY: 10,
  /** Alternative fonts 1-9 */
  FONT_ALT_1: 11,
  FONT_ALT_2: 12,
  FONT_ALT_3: 13,
  FONT_ALT_4: 14,
  FONT_ALT_5: 15,
  FONT_ALT_6: 16,
  FONT_ALT_7: 17,
  FONT_ALT_8: 18,
  FONT_ALT_9: 19,
  /** Fraktur (rarely supported) */
  FRAKTUR: 20,

  // Double underline and attribute resets
  /** Double underline */
  DOUBLE_UNDERLINE: 21,
  /** Normal intensity (not bold, not dim) */
  NORMAL_INTENSITY: 22,
  /** Not italic, not fraktur */
  NOT_ITALIC: 23,
  /** Not underlined */
  NOT_UNDERLINE: 24,
  /** Not blinking */
  NOT_BLINK: 25,
  /** Proportional spacing (rarely supported) */
  PROPORTIONAL: 26,
  /** Not inverse */
  NOT_INVERSE: 27,
  /** Not hidden */
  NOT_HIDDEN: 28,
  /** Not strikethrough */
  NOT_STRIKETHROUGH: 29,

  // Standard Foreground Colors (30-37)
  /** Black foreground */
  FG_BLACK: 30,
  /** Red foreground */
  FG_RED: 31,
  /** Green foreground */
  FG_GREEN: 32,
  /** Yellow foreground */
  FG_YELLOW: 33,
  /** Blue foreground */
  FG_BLUE: 34,
  /** Magenta foreground */
  FG_MAGENTA: 35,
  /** Cyan foreground */
  FG_CYAN: 36,
  /** White foreground */
  FG_WHITE: 37,

  // Extended Colors
  /** Extended foreground color (256/RGB) */
  FG_EXTENDED: 38,
  /** Default foreground color */
  FG_DEFAULT: 39,

  // Standard Background Colors (40-47)
  /** Black background */
  BG_BLACK: 40,
  /** Red background */
  BG_RED: 41,
  /** Green background */
  BG_GREEN: 42,
  /** Yellow background */
  BG_YELLOW: 43,
  /** Blue background */
  BG_BLUE: 44,
  /** Magenta background */
  BG_MAGENTA: 45,
  /** Cyan background */
  BG_CYAN: 46,
  /** White background */
  BG_WHITE: 47,

  // Extended Colors
  /** Extended background color (256/RGB) */
  BG_EXTENDED: 48,
  /** Default background color */
  BG_DEFAULT: 49,

  // Additional attributes (50-75)
  /** Disable proportional spacing */
  NOT_PROPORTIONAL: 50,
  /** Framed */
  FRAMED: 51,
  /** Encircled */
  ENCIRCLED: 52,
  /** Overlined */
  OVERLINED: 53,
  /** Not framed, not encircled */
  NOT_FRAMED: 54,
  /** Not overlined */
  NOT_OVERLINED: 55,
  /** Underline color (next params: 5;n or 2;r;g;b) */
  UNDERLINE_COLOR: 58,
  /** Default underline color */
  UNDERLINE_COLOR_DEFAULT: 59,

  // Bright Foreground Colors (90-97)
  /** Bright black (gray) foreground */
  FG_BRIGHT_BLACK: 90,
  /** Bright red foreground */
  FG_BRIGHT_RED: 91,
  /** Bright green foreground */
  FG_BRIGHT_GREEN: 92,
  /** Bright yellow foreground */
  FG_BRIGHT_YELLOW: 93,
  /** Bright blue foreground */
  FG_BRIGHT_BLUE: 94,
  /** Bright magenta foreground */
  FG_BRIGHT_MAGENTA: 95,
  /** Bright cyan foreground */
  FG_BRIGHT_CYAN: 96,
  /** Bright white foreground */
  FG_BRIGHT_WHITE: 97,

  // Bright Background Colors (100-107)
  /** Bright black (gray) background */
  BG_BRIGHT_BLACK: 100,
  /** Bright red background */
  BG_BRIGHT_RED: 101,
  /** Bright green background */
  BG_BRIGHT_GREEN: 102,
  /** Bright yellow background */
  BG_BRIGHT_YELLOW: 103,
  /** Bright blue background */
  BG_BRIGHT_BLUE: 104,
  /** Bright magenta background */
  BG_BRIGHT_MAGENTA: 105,
  /** Bright cyan background */
  BG_BRIGHT_CYAN: 106,
  /** Bright white background */
  BG_BRIGHT_WHITE: 107,

  // Extended color sub-modes
  /** 256-color mode indicator */
  COLOR_256: 5,
  /** RGB/truecolor mode indicator */
  COLOR_RGB: 2,
} as const

// ============================================================================
// Escape Sequence Final Characters
// ============================================================================

export const ESCCommands = {
  /** Save Cursor (DECSC) */
  DECSC: '7',
  /** Restore Cursor (DECRC) */
  DECRC: '8',
  /** Reverse Index - move cursor up, scroll if at top */
  RI: 'M',
  /** Reset to Initial State (RIS) */
  RIS: 'c',
  /** Index - move cursor down, scroll if at bottom */
  IND: 'D',
  /** Next Line - move to column 1 of next line */
  NEL: 'E',
  /** Horizontal Tab Set */
  HTS: 'H',
  /** Single Shift 2 */
  SS2: 'N',
  /** Single Shift 3 */
  SS3: 'O',
  /** Start of Protected Area */
  SPA: 'V',
  /** End of Protected Area */
  EPA: 'W',
  /** Character Set - G0 designate */
  CS_G0: '(',
  /** Character Set - G1 designate */
  CS_G1: ')',
  /** Character Set - G2 designate */
  CS_G2: '*',
  /** Character Set - G3 designate */
  CS_G3: '+',
} as const

// ============================================================================
// OSC (Operating System Command) Codes
// ============================================================================

export const OSCCommands = {
  /** Set icon name and window title */
  SET_TITLE: 0,
  /** Set icon name */
  SET_ICON_NAME: 1,
  /** Set window title */
  SET_WINDOW_TITLE: 2,
  /** Set X property on top-level window */
  SET_X_PROPERTY: 3,
  /** Change/query color palette */
  CHANGE_COLOR: 4,
  /** Special color (foreground, background, etc.) */
  SPECIAL_COLOR: 5,
  /** Enable/disable special color */
  ENABLE_SPECIAL_COLOR: 6,
  /** Set highlighting colors */
  SET_HIGHLIGHT_COLOR: 7,
  /** Set Tek foreground/background color */
  SET_TEK_COLOR: 8,
  /** Set foreground color */
  SET_FG_COLOR: 10,
  /** Set background color */
  SET_BG_COLOR: 11,
  /** Set cursor color */
  SET_CURSOR_COLOR: 12,
  /** Set mouse foreground color */
  SET_MOUSE_FG: 13,
  /** Set mouse background color */
  SET_MOUSE_BG: 14,
  /** Set Tek cursor color */
  SET_TEK_CURSOR: 15,
  /** Set highlight foreground color */
  SET_HIGHLIGHT_FG: 16,
  /** Set highlight background color */
  SET_HIGHLIGHT_BG: 17,
  /** Set font */
  SET_FONT: 50,
  /** Clipboard access */
  CLIPBOARD: 52,
  /** Reset colors */
  RESET_COLOR: 104,
  /** Reset special colors */
  RESET_SPECIAL_COLOR: 105,
  /** Reset text foreground color */
  RESET_FG_COLOR: 110,
  /** Reset text background color */
  RESET_BG_COLOR: 111,
  /** Reset cursor color */
  RESET_CURSOR_COLOR: 112,
  /** Reset highlight colors */
  RESET_HIGHLIGHT_COLOR: 117,
} as const

// ============================================================================
// Byte Range Constants (for parser state machine)
// ============================================================================

export const ByteRanges = {
  /** Start of printable ASCII */
  PRINTABLE_START: 0x20,
  /** End of printable ASCII */
  PRINTABLE_END: 0x7e,
  /** Start of C0 control codes */
  C0_START: 0x00,
  /** End of C0 control codes */
  C0_END: 0x1f,
  /** Start of intermediate characters */
  INTERMEDIATE_START: 0x20,
  /** End of intermediate characters */
  INTERMEDIATE_END: 0x2f,
  /** Start of parameter bytes (0-9, :, ;) */
  PARAM_START: 0x30,
  /** End of parameter bytes */
  PARAM_END: 0x3b,
  /** Start of private markers (<, =, >, ?) */
  PRIVATE_START: 0x3c,
  /** End of private markers */
  PRIVATE_END: 0x3f,
  /** Start of CSI final bytes */
  CSI_FINAL_START: 0x40,
  /** End of CSI final bytes */
  CSI_FINAL_END: 0x7e,
  /** Start of ESC final bytes */
  ESC_FINAL_START: 0x30,
  /** End of ESC final bytes */
  ESC_FINAL_END: 0x7e,
} as const

// ============================================================================
// Special Characters
// ============================================================================

export const SpecialChars = {
  /** Space character */
  SPACE: ' ',
  /** Parameter separator */
  PARAM_SEPARATOR: ';',
  /** Sub-parameter separator (for RGB colors) */
  SUBPARAM_SEPARATOR: ':',
  /** Private marker for DEC modes */
  PRIVATE_MARKER: '?',
  /** Greater-than private marker */
  PRIVATE_GT: '>',
  /** Less-than private marker */
  PRIVATE_LT: '<',
  /** Equals private marker */
  PRIVATE_EQ: '=',
} as const
