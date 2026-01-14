/**
 * Screen Buffer
 *
 * Maintains terminal display state including cells, cursor, and attributes.
 * Provides methods for manipulating the screen buffer.
 *
 * @packageDocumentation
 */

import type {
  Cell,
  CellAttributes,
  Color,
  CursorState,
  ScreenBuffer,
} from './types.js'

// ============================================================================
// Default Values
// ============================================================================

/**
 * Create default cell attributes (white on black, no decorations)
 */
export function createDefaultAttributes(): CellAttributes {
  return {
    fg: 'default',
    bg: 'default',
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    inverse: false,
    hidden: false,
    strikethrough: false,
  }
}

/**
 * Create an empty cell with default attributes
 */
export function createEmptyCell(attrs?: CellAttributes): Cell {
  return {
    char: ' ',
    width: 1,
    attrs: attrs ? { ...attrs } : createDefaultAttributes(),
  }
}

/**
 * Create default cursor state
 */
export function createDefaultCursor(): CursorState {
  return {
    x: 0,
    y: 0,
    visible: true,
    style: 'block',
    blinking: true,
  }
}

// ============================================================================
// Screen Buffer Class
// ============================================================================

/**
 * Terminal screen buffer that tracks display state.
 *
 * @example
 * ```typescript
 * const buffer = new TerminalBuffer(80, 24)
 *
 * // Write a character at cursor position
 * buffer.writeChar('H')
 * buffer.writeChar('i')
 *
 * // Move cursor
 * buffer.moveCursor(10, 5)
 *
 * // Set colors
 * buffer.setForeground(1) // red
 * buffer.writeChar('!')
 *
 * // Get string representation
 * console.log(buffer.toString())
 * ```
 */
export class TerminalBuffer implements ScreenBuffer {
  cols: number
  rows: number
  cells: Cell[][]
  cursor: CursorState
  defaultAttrs: CellAttributes
  scrollTop: number
  scrollBottom: number

  /** Saved cursor state for save/restore operations */
  private savedCursor: CursorState | null = null

  /** Saved attributes for save/restore operations */
  private savedAttrs: CellAttributes | null = null

  /** Tab stops */
  private tabStops: Set<number>

  constructor(cols: number = 80, rows: number = 24) {
    this.cols = cols
    this.rows = rows
    this.defaultAttrs = createDefaultAttributes()
    this.cursor = createDefaultCursor()
    this.scrollTop = 0
    this.scrollBottom = rows - 1
    this.cells = this.createEmptyGrid(cols, rows)
    this.tabStops = this.createDefaultTabStops(cols)
  }

  /**
   * Create an empty grid of cells
   */
  private createEmptyGrid(cols: number, rows: number): Cell[][] {
    const grid: Cell[][] = []
    for (let row = 0; row < rows; row++) {
      const line: Cell[] = []
      for (let col = 0; col < cols; col++) {
        line.push(createEmptyCell(this.defaultAttrs))
      }
      grid.push(line)
    }
    return grid
  }

  /**
   * Create default tab stops (every 8 columns)
   */
  private createDefaultTabStops(cols: number): Set<number> {
    const stops = new Set<number>()
    for (let i = 8; i < cols; i += 8) {
      stops.add(i)
    }
    return stops
  }

  /**
   * Resize the buffer
   */
  resize(newCols: number, newRows: number): void {
    const newCells: Cell[][] = []

    for (let row = 0; row < newRows; row++) {
      const line: Cell[] = []
      for (let col = 0; col < newCols; col++) {
        if (row < this.rows && col < this.cols) {
          // Copy existing cell
          line.push({ ...this.cells[row][col] })
        } else {
          // Create new empty cell
          line.push(createEmptyCell(this.defaultAttrs))
        }
      }
      newCells.push(line)
    }

    this.cells = newCells
    this.cols = newCols
    this.rows = newRows
    this.scrollBottom = newRows - 1
    this.tabStops = this.createDefaultTabStops(newCols)

    // Clamp cursor position
    this.cursor.x = Math.min(this.cursor.x, newCols - 1)
    this.cursor.y = Math.min(this.cursor.y, newRows - 1)
  }

  /**
   * Write a character at the current cursor position
   */
  writeChar(char: string): void {
    // Handle cursor at end of line
    if (this.cursor.x >= this.cols) {
      this.cursor.x = 0
      this.lineFeed()
    }

    // Write character
    this.cells[this.cursor.y][this.cursor.x] = {
      char,
      width: 1, // TODO: Handle wide characters
      attrs: { ...this.defaultAttrs },
    }

    // Advance cursor
    this.cursor.x++
  }

  /**
   * Write a string at the current cursor position
   */
  writeString(str: string): void {
    for (const char of str) {
      this.writeChar(char)
    }
  }

  /**
   * Move cursor to absolute position
   */
  moveCursor(x: number, y: number): void {
    this.cursor.x = Math.max(0, Math.min(x, this.cols - 1))
    this.cursor.y = Math.max(0, Math.min(y, this.rows - 1))
  }

  /**
   * Move cursor relative to current position
   */
  moveCursorRelative(dx: number, dy: number): void {
    this.moveCursor(this.cursor.x + dx, this.cursor.y + dy)
  }

  /**
   * Move cursor up by n rows
   */
  cursorUp(n: number = 1): void {
    this.cursor.y = Math.max(this.scrollTop, this.cursor.y - n)
  }

  /**
   * Move cursor down by n rows
   */
  cursorDown(n: number = 1): void {
    this.cursor.y = Math.min(this.scrollBottom, this.cursor.y + n)
  }

  /**
   * Move cursor forward by n columns
   */
  cursorForward(n: number = 1): void {
    this.cursor.x = Math.min(this.cols - 1, this.cursor.x + n)
  }

  /**
   * Move cursor backward by n columns
   */
  cursorBackward(n: number = 1): void {
    this.cursor.x = Math.max(0, this.cursor.x - n)
  }

  /**
   * Carriage return - move cursor to column 0
   */
  carriageReturn(): void {
    this.cursor.x = 0
  }

  /**
   * Line feed - move cursor down, scroll if needed
   */
  lineFeed(): void {
    if (this.cursor.y >= this.scrollBottom) {
      this.scrollUp(1)
    } else {
      this.cursor.y++
    }
  }

  /**
   * Reverse line feed - move cursor up, scroll if needed
   */
  reverseLineFeed(): void {
    if (this.cursor.y <= this.scrollTop) {
      this.scrollDown(1)
    } else {
      this.cursor.y--
    }
  }

  /**
   * Tab - move to next tab stop
   */
  tab(): void {
    // Find next tab stop
    for (let i = this.cursor.x + 1; i < this.cols; i++) {
      if (this.tabStops.has(i)) {
        this.cursor.x = i
        return
      }
    }
    // No more tab stops, move to end
    this.cursor.x = this.cols - 1
  }

  /**
   * Backspace - move cursor left
   */
  backspace(): void {
    if (this.cursor.x > 0) {
      this.cursor.x--
    }
  }

  /**
   * Scroll up by n lines (content moves up, new lines at bottom)
   */
  scrollUp(n: number = 1): void {
    for (let i = 0; i < n; i++) {
      // Remove top line of scroll region
      this.cells.splice(this.scrollTop, 1)
      // Insert empty line at bottom of scroll region
      const newLine: Cell[] = []
      for (let col = 0; col < this.cols; col++) {
        newLine.push(createEmptyCell(this.defaultAttrs))
      }
      this.cells.splice(this.scrollBottom, 0, newLine)
    }
  }

  /**
   * Scroll down by n lines (content moves down, new lines at top)
   */
  scrollDown(n: number = 1): void {
    for (let i = 0; i < n; i++) {
      // Remove bottom line of scroll region
      this.cells.splice(this.scrollBottom, 1)
      // Insert empty line at top of scroll region
      const newLine: Cell[] = []
      for (let col = 0; col < this.cols; col++) {
        newLine.push(createEmptyCell(this.defaultAttrs))
      }
      this.cells.splice(this.scrollTop, 0, newLine)
    }
  }

  /**
   * Set scroll region
   */
  setScrollRegion(top: number, bottom: number): void {
    this.scrollTop = Math.max(0, Math.min(top, this.rows - 1))
    this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this.rows - 1))
  }

  /**
   * Erase from cursor to end of line
   */
  eraseToEndOfLine(): void {
    for (let x = this.cursor.x; x < this.cols; x++) {
      this.cells[this.cursor.y][x] = createEmptyCell(this.defaultAttrs)
    }
  }

  /**
   * Erase from start of line to cursor
   */
  eraseToStartOfLine(): void {
    for (let x = 0; x <= this.cursor.x; x++) {
      this.cells[this.cursor.y][x] = createEmptyCell(this.defaultAttrs)
    }
  }

  /**
   * Erase entire line
   */
  eraseLine(): void {
    for (let x = 0; x < this.cols; x++) {
      this.cells[this.cursor.y][x] = createEmptyCell(this.defaultAttrs)
    }
  }

  /**
   * Erase from cursor to end of screen
   */
  eraseToEndOfScreen(): void {
    // Current line from cursor
    this.eraseToEndOfLine()
    // All lines below
    for (let y = this.cursor.y + 1; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.cells[y][x] = createEmptyCell(this.defaultAttrs)
      }
    }
  }

  /**
   * Erase from start of screen to cursor
   */
  eraseToStartOfScreen(): void {
    // All lines above
    for (let y = 0; y < this.cursor.y; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.cells[y][x] = createEmptyCell(this.defaultAttrs)
      }
    }
    // Current line to cursor
    this.eraseToStartOfLine()
  }

  /**
   * Erase entire screen
   */
  eraseScreen(): void {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.cells[y][x] = createEmptyCell(this.defaultAttrs)
      }
    }
  }

  /**
   * Insert n blank characters at cursor
   */
  insertChars(n: number): void {
    const line = this.cells[this.cursor.y]
    // Shift characters right
    for (let i = 0; i < n; i++) {
      line.pop()
      line.splice(this.cursor.x, 0, createEmptyCell(this.defaultAttrs))
    }
  }

  /**
   * Delete n characters at cursor
   */
  deleteChars(n: number): void {
    const line = this.cells[this.cursor.y]
    // Remove characters and add blanks at end
    for (let i = 0; i < n && this.cursor.x < this.cols; i++) {
      line.splice(this.cursor.x, 1)
      line.push(createEmptyCell(this.defaultAttrs))
    }
  }

  /**
   * Insert n blank lines at cursor
   */
  insertLines(n: number): void {
    if (this.cursor.y < this.scrollTop || this.cursor.y > this.scrollBottom) {
      return
    }

    for (let i = 0; i < n; i++) {
      // Remove bottom line
      this.cells.splice(this.scrollBottom, 1)
      // Insert blank line at cursor
      const newLine: Cell[] = []
      for (let col = 0; col < this.cols; col++) {
        newLine.push(createEmptyCell(this.defaultAttrs))
      }
      this.cells.splice(this.cursor.y, 0, newLine)
    }
  }

  /**
   * Delete n lines at cursor
   */
  deleteLines(n: number): void {
    if (this.cursor.y < this.scrollTop || this.cursor.y > this.scrollBottom) {
      return
    }

    for (let i = 0; i < n; i++) {
      // Remove line at cursor
      this.cells.splice(this.cursor.y, 1)
      // Insert blank line at scroll bottom
      const newLine: Cell[] = []
      for (let col = 0; col < this.cols; col++) {
        newLine.push(createEmptyCell(this.defaultAttrs))
      }
      this.cells.splice(this.scrollBottom, 0, newLine)
    }
  }

  /**
   * Set foreground color
   */
  setForeground(color: Color): void {
    this.defaultAttrs.fg = color
  }

  /**
   * Set background color
   */
  setBackground(color: Color): void {
    this.defaultAttrs.bg = color
  }

  /**
   * Reset all attributes to defaults
   */
  resetAttributes(): void {
    this.defaultAttrs = createDefaultAttributes()
  }

  /**
   * Set a specific attribute
   */
  setAttribute(attr: keyof Omit<CellAttributes, 'fg' | 'bg'>, value: boolean): void {
    this.defaultAttrs[attr] = value
  }

  /**
   * Save cursor position and attributes
   */
  saveCursor(): void {
    this.savedCursor = { ...this.cursor }
    this.savedAttrs = { ...this.defaultAttrs }
  }

  /**
   * Restore cursor position and attributes
   */
  restoreCursor(): void {
    if (this.savedCursor) {
      this.cursor = { ...this.savedCursor }
    }
    if (this.savedAttrs) {
      this.defaultAttrs = { ...this.savedAttrs }
    }
  }

  /**
   * Set cursor visibility
   */
  setCursorVisible(visible: boolean): void {
    this.cursor.visible = visible
  }

  /**
   * Get cell at position
   */
  getCell(x: number, y: number): Cell | null {
    if (y >= 0 && y < this.rows && x >= 0 && x < this.cols) {
      return this.cells[y][x]
    }
    return null
  }

  /**
   * Get line as string
   */
  getLine(y: number): string {
    if (y < 0 || y >= this.rows) {
      return ''
    }
    return this.cells[y].map(cell => cell.char).join('')
  }

  /**
   * Get all lines as string array
   */
  getLines(): string[] {
    return this.cells.map(row => row.map(cell => cell.char).join(''))
  }

  /**
   * Get screen content as string (lines joined with newlines)
   */
  toString(): string {
    return this.getLines().map(line => line.trimEnd()).join('\n')
  }

  /**
   * Get a snapshot of the current buffer state
   */
  snapshot(): ScreenBuffer {
    return {
      cols: this.cols,
      rows: this.rows,
      cells: this.cells.map(row => row.map(cell => ({
        char: cell.char,
        width: cell.width,
        attrs: { ...cell.attrs },
      }))),
      cursor: { ...this.cursor },
      defaultAttrs: { ...this.defaultAttrs },
      scrollTop: this.scrollTop,
      scrollBottom: this.scrollBottom,
    }
  }
}
