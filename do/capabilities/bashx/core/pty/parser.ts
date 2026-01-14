/**
 * ANSI Escape Sequence Parser
 *
 * State machine parser for VT100/VT500 compatible ANSI escape sequences.
 * Based on the DEC ANSI parser specification.
 *
 * @see https://vt100.net/emu/dec_ansi_parser
 * @packageDocumentation
 */

import type { ParserState, ParsedSequence, SequenceCallback } from './types.js'
import {
  ESC,
  BEL,
  CAN,
  SUB,
  DEL,
  CSI_8BIT,
  ST_8BIT,
  DCS_8BIT,
  OSC_8BIT,
  SOS_8BIT,
  PM_8BIT,
  APC_8BIT,
} from './constants.js'

// ============================================================================
// Parser Class
// ============================================================================

/**
 * ANSI escape sequence parser using a state machine approach.
 *
 * @example
 * ```typescript
 * const parser = new ANSIParser({
 *   onSequence: (seq) => console.log('Parsed:', seq),
 *   onPrint: (char) => screen.writeChar(char),
 *   onExecute: (code) => handleControl(code),
 * })
 *
 * parser.parse('\x1b[31mHello\x1b[0m')
 * ```
 */
export class ANSIParser {
  /** Current parser state */
  private state: ParserState = 'ground'

  /** Collected intermediate characters */
  private intermediates = ''

  /** Private marker character (e.g., '?' or '>') */
  private privateMarker = ''

  /** Collected numeric parameters */
  private params: number[] = []

  /** Current parameter being built */
  private currentParam = ''

  /** Raw sequence accumulator */
  private rawSequence = ''

  /** OSC string accumulator */
  private oscString = ''

  /** DCS string accumulator */
  private dcsString = ''

  /** Callbacks */
  private onSequence?: SequenceCallback
  private onPrint?: (char: string, code: number) => void
  private onExecute?: (code: number) => void
  private onOSC?: (params: string[]) => void

  constructor(options: {
    onSequence?: SequenceCallback
    onPrint?: (char: string, code: number) => void
    onExecute?: (code: number) => void
    onOSC?: (params: string[]) => void
  } = {}) {
    this.onSequence = options.onSequence
    this.onPrint = options.onPrint
    this.onExecute = options.onExecute
    this.onOSC = options.onOSC
  }

  /**
   * Parse input data (string or byte array)
   */
  parse(data: string | Uint8Array): void {
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data

    for (let i = 0; i < bytes.length; i++) {
      this.processByte(bytes[i])
    }
  }

  /**
   * Reset parser to initial state
   */
  reset(): void {
    this.state = 'ground'
    this.clear()
  }

  /**
   * Get current parser state (for debugging)
   */
  getState(): ParserState {
    return this.state
  }

  /**
   * Clear accumulated sequence data
   */
  private clear(): void {
    this.intermediates = ''
    this.privateMarker = ''
    this.params = []
    this.currentParam = ''
    this.rawSequence = ''
    this.oscString = ''
    this.dcsString = ''
  }

  /**
   * Process a single byte through the state machine
   */
  private processByte(byte: number): void {
    // Handle "anywhere" transitions that override current state
    if (this.handleAnywhere(byte)) {
      return
    }

    // Handle state-specific transitions
    switch (this.state) {
      case 'ground':
        this.handleGround(byte)
        break
      case 'escape':
        this.handleEscape(byte)
        break
      case 'escape_intermediate':
        this.handleEscapeIntermediate(byte)
        break
      case 'csi_entry':
        this.handleCSIEntry(byte)
        break
      case 'csi_param':
        this.handleCSIParam(byte)
        break
      case 'csi_intermediate':
        this.handleCSIIntermediate(byte)
        break
      case 'csi_ignore':
        this.handleCSIIgnore(byte)
        break
      case 'osc_string':
        this.handleOSCString(byte)
        break
      case 'dcs_entry':
        this.handleDCSEntry(byte)
        break
      case 'dcs_param':
        this.handleDCSParam(byte)
        break
      case 'dcs_intermediate':
        this.handleDCSIntermediate(byte)
        break
      case 'dcs_passthrough':
        this.handleDCSPassthrough(byte)
        break
      case 'dcs_ignore':
        this.handleDCSIgnore(byte)
        break
      case 'sos_pm_apc_string':
        this.handleSOSPMAPCString(byte)
        break
    }
  }

  /**
   * Handle "anywhere" transitions that can occur from any state
   * @returns true if transition was handled
   */
  private handleAnywhere(byte: number): boolean {
    // CAN and SUB abort any sequence
    if (byte === CAN || byte === SUB) {
      this.state = 'ground'
      this.clear()
      return true
    }

    // ESC enters escape state from anywhere
    if (byte === ESC) {
      this.state = 'escape'
      this.clear()
      this.rawSequence = '\x1b'
      return true
    }

    // 8-bit C1 controls
    if (byte === CSI_8BIT) {
      this.state = 'csi_entry'
      this.clear()
      this.rawSequence = String.fromCharCode(byte)
      return true
    }

    if (byte === DCS_8BIT) {
      this.state = 'dcs_entry'
      this.clear()
      this.rawSequence = String.fromCharCode(byte)
      return true
    }

    if (byte === OSC_8BIT) {
      this.state = 'osc_string'
      this.clear()
      this.rawSequence = String.fromCharCode(byte)
      return true
    }

    if (byte === SOS_8BIT || byte === PM_8BIT || byte === APC_8BIT) {
      this.state = 'sos_pm_apc_string'
      this.clear()
      return true
    }

    if (byte === ST_8BIT) {
      // String terminator - return to ground
      this.state = 'ground'
      this.clear()
      return true
    }

    return false
  }

  /**
   * Handle ground state - normal character printing
   */
  private handleGround(byte: number): void {
    // C0 controls (execute immediately)
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // Printable characters (0x20-0x7E and 0xA0-0xFF)
    const char = String.fromCharCode(byte)
    this.onPrint?.(char, byte)
  }

  /**
   * Handle escape state
   */
  private handleEscape(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // C0 controls - execute immediately
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // Intermediate bytes (0x20-0x2F) - collect
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      this.state = 'escape_intermediate'
      return
    }

    // CSI introducer '['
    if (byte === 0x5b) {
      this.state = 'csi_entry'
      return
    }

    // OSC introducer ']'
    if (byte === 0x5d) {
      this.state = 'osc_string'
      return
    }

    // DCS introducer 'P'
    if (byte === 0x50) {
      this.state = 'dcs_entry'
      return
    }

    // SOS, PM, APC introducers
    if (byte === 0x58 || byte === 0x5e || byte === 0x5f) {
      this.state = 'sos_pm_apc_string'
      return
    }

    // Final bytes (0x30-0x7E except those above) - dispatch and return to ground
    if (byte >= 0x30 && byte <= 0x7e) {
      this.dispatchEscape(byte)
      this.state = 'ground'
      return
    }

    // Invalid - return to ground
    this.state = 'ground'
  }

  /**
   * Handle escape_intermediate state
   */
  private handleEscapeIntermediate(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // C0 controls - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // More intermediates
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      return
    }

    // Final byte - dispatch
    if (byte >= 0x30 && byte <= 0x7e) {
      this.dispatchEscape(byte)
      this.state = 'ground'
      return
    }

    // Invalid - return to ground
    this.state = 'ground'
  }

  /**
   * Handle CSI entry state
   */
  private handleCSIEntry(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // C0 controls - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // Private markers (0x3C-0x3F: < = > ?)
    if (byte >= 0x3c && byte <= 0x3f) {
      this.privateMarker = String.fromCharCode(byte)
      this.state = 'csi_param'
      return
    }

    // Parameter bytes (0x30-0x3B: 0-9, :, ;)
    if (byte >= 0x30 && byte <= 0x3b) {
      this.collectParam(byte)
      this.state = 'csi_param'
      return
    }

    // Intermediate bytes
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      this.state = 'csi_intermediate'
      return
    }

    // Final bytes - dispatch
    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.dispatchCSI(byte)
      this.state = 'ground'
      return
    }

    // Invalid - ignore rest of sequence
    this.state = 'csi_ignore'
  }

  /**
   * Handle CSI param state
   */
  private handleCSIParam(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // C0 controls - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // Parameter bytes (0x30-0x3B)
    if (byte >= 0x30 && byte <= 0x3b) {
      // Colon (0x3A) in params is invalid in strict mode but we collect anyway
      this.collectParam(byte)
      return
    }

    // Private markers in wrong position - ignore sequence
    if (byte >= 0x3c && byte <= 0x3f) {
      this.state = 'csi_ignore'
      return
    }

    // Intermediate bytes
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      this.state = 'csi_intermediate'
      return
    }

    // Final bytes - dispatch
    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.dispatchCSI(byte)
      this.state = 'ground'
      return
    }

    // Invalid
    this.state = 'csi_ignore'
  }

  /**
   * Handle CSI intermediate state
   */
  private handleCSIIntermediate(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // C0 controls - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // More intermediates
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      return
    }

    // Final bytes - dispatch
    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.dispatchCSI(byte)
      this.state = 'ground'
      return
    }

    // Invalid - ignore rest
    this.state = 'csi_ignore'
  }

  /**
   * Handle CSI ignore state - discard until final byte
   */
  private handleCSIIgnore(byte: number): void {
    // C0 controls - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // DEL - ignore
    if (byte === DEL) {
      return
    }

    // Final byte - return to ground
    if (byte >= 0x40 && byte <= 0x7e) {
      this.state = 'ground'
    }
  }

  /**
   * Handle OSC string state
   */
  private handleOSCString(byte: number): void {
    // BEL terminates OSC (common extension)
    if (byte === BEL) {
      this.dispatchOSC()
      this.state = 'ground'
      return
    }

    // ST (ESC \) also terminates - handled by handleAnywhere for 8-bit
    // For 7-bit, ESC triggers transition and backslash will be handled

    // C0 controls other than BEL - mostly ignore in OSC
    if (byte < 0x20) {
      // Could execute some controls here if needed
      return
    }

    // Accumulate string
    this.oscString += String.fromCharCode(byte)
  }

  /**
   * Handle DCS entry state
   */
  private handleDCSEntry(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    // Private markers
    if (byte >= 0x3c && byte <= 0x3f) {
      this.privateMarker = String.fromCharCode(byte)
      this.state = 'dcs_param'
      return
    }

    // Parameters
    if (byte >= 0x30 && byte <= 0x3b) {
      this.collectParam(byte)
      this.state = 'dcs_param'
      return
    }

    // Intermediates
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      this.state = 'dcs_intermediate'
      return
    }

    // Final byte - enter passthrough
    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.state = 'dcs_passthrough'
      return
    }

    // C0 - execute
    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    // Invalid
    this.state = 'dcs_ignore'
  }

  /**
   * Handle DCS param state
   */
  private handleDCSParam(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    if (byte >= 0x30 && byte <= 0x3b) {
      this.collectParam(byte)
      return
    }

    if (byte >= 0x3c && byte <= 0x3f) {
      this.state = 'dcs_ignore'
      return
    }

    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      this.state = 'dcs_intermediate'
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.state = 'dcs_passthrough'
      return
    }

    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    this.state = 'dcs_ignore'
  }

  /**
   * Handle DCS intermediate state
   */
  private handleDCSIntermediate(byte: number): void {
    this.rawSequence += String.fromCharCode(byte)

    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte)
      return
    }

    if (byte >= 0x40 && byte <= 0x7e) {
      this.finalizeParams()
      this.state = 'dcs_passthrough'
      return
    }

    if (byte < 0x20) {
      this.execute(byte)
      return
    }

    this.state = 'dcs_ignore'
  }

  /**
   * Handle DCS passthrough state
   */
  private handleDCSPassthrough(byte: number): void {
    // C0 controls (except specific ones) pass through
    // Accumulate for now; proper implementation would have hook
    this.dcsString += String.fromCharCode(byte)
  }

  /**
   * Handle DCS ignore state
   */
  private handleDCSIgnore(_byte: number): void {
    // Just wait for ST
  }

  /**
   * Handle SOS/PM/APC string state - ignore until ST
   */
  private handleSOSPMAPCString(_byte: number): void {
    // These are not implemented, just wait for ST
  }

  /**
   * Collect a parameter byte
   */
  private collectParam(byte: number): void {
    const char = String.fromCharCode(byte)
    if (char === ';') {
      // Parameter separator - finalize current and start new
      this.params.push(this.currentParam === '' ? 0 : parseInt(this.currentParam, 10))
      this.currentParam = ''
    } else if (char === ':') {
      // Sub-parameter separator (SGR uses this for RGB colors)
      // For simplicity, treat like regular separator
      this.params.push(this.currentParam === '' ? 0 : parseInt(this.currentParam, 10))
      this.currentParam = ''
    } else {
      // Digit
      this.currentParam += char
    }
  }

  /**
   * Finalize parameter collection
   */
  private finalizeParams(): void {
    if (this.currentParam !== '' || this.params.length > 0) {
      this.params.push(this.currentParam === '' ? 0 : parseInt(this.currentParam, 10))
    }
    this.currentParam = ''
  }

  /**
   * Execute a C0 control character
   */
  private execute(byte: number): void {
    this.onExecute?.(byte)
  }

  /**
   * Dispatch an escape sequence
   */
  private dispatchEscape(finalByte: number): void {
    const sequence: ParsedSequence = {
      type: 'esc',
      finalChar: String.fromCharCode(finalByte),
      intermediates: this.intermediates,
      params: [],
      raw: this.rawSequence,
    }
    this.onSequence?.(sequence)
    this.clear()
  }

  /**
   * Dispatch a CSI sequence
   */
  private dispatchCSI(finalByte: number): void {
    const sequence: ParsedSequence = {
      type: 'csi',
      finalChar: String.fromCharCode(finalByte),
      privateMarker: this.privateMarker || undefined,
      intermediates: this.intermediates,
      params: this.params.length > 0 ? this.params : [],
      raw: this.rawSequence,
    }
    this.onSequence?.(sequence)
    this.clear()
  }

  /**
   * Dispatch an OSC sequence
   */
  private dispatchOSC(): void {
    // OSC format: Ps ; Pt BEL (or ST)
    // Ps = parameter number, Pt = string
    const parts = this.oscString.split(';')
    this.onOSC?.(parts)
    this.clear()
  }
}
