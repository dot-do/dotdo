/**
 * Terminal Renderer - Multi-tier output rendering using mdxui patterns
 *
 * Provides rich terminal UI rendering with graceful degradation across tiers:
 * - Text tier: Plain text for minimal clients (MCP fallback)
 * - Markdown tier: For AI agents via MCP
 * - ANSI tier: For browser/CLI clients with xterm.js
 *
 * @module bashx/do/terminal-renderer
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Rendering tier levels
 */
export type RenderTier = 'text' | 'markdown' | 'ansi'

/**
 * Options for rendering output
 */
export interface RenderOptions {
  /** The rendering tier to use */
  tier: RenderTier
  /** Terminal width in characters (default: 80) */
  width?: number
  /** Color depth: 0 (none), 8 (basic), 256, or 16777216 (truecolor) */
  colorDepth?: number
  /** Whether to use unicode box-drawing characters */
  useUnicode?: boolean
}

/**
 * Badge variants for status indicators
 */
export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

/**
 * Progress bar options
 */
export interface ProgressOptions extends RenderOptions {
  /** Show percentage number */
  showPercentage?: boolean
  /** Progress bar width (default: 20) */
  barWidth?: number
}

/**
 * Panel options
 */
export interface PanelOptions extends RenderOptions {
  /** Panel border style */
  border?: 'none' | 'single' | 'double' | 'rounded'
  /** Padding inside panel */
  padding?: number
}

/**
 * Table column definition
 */
export interface TableColumn {
  /** Column header */
  header: string
  /** Key to access data */
  key: string
  /** Column width (auto if not specified) */
  width?: number
  /** Text alignment */
  align?: 'left' | 'center' | 'right'
}

/**
 * Table options
 */
export interface TableOptions extends RenderOptions {
  /** Column definitions (auto-detected if not provided) */
  columns?: TableColumn[]
  /** Whether to show headers */
  showHeaders?: boolean
  /** Maximum rows to show before truncating */
  maxRows?: number
  /** Border style */
  border?: 'none' | 'ascii' | 'unicode'
}

/**
 * Spinner options
 */
export interface SpinnerOptions extends RenderOptions {
  /** Spinner frame index (for stateless rendering) */
  frame?: number
}

// ============================================================================
// ANSI COLOR CODES
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright foreground colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
} as const

// Unicode box-drawing characters
const BOX = {
  single: {
    topLeft: '\u250c',
    topRight: '\u2510',
    bottomLeft: '\u2514',
    bottomRight: '\u2518',
    horizontal: '\u2500',
    vertical: '\u2502',
    cross: '\u253c',
    teeDown: '\u252c',
    teeUp: '\u2534',
    teeRight: '\u251c',
    teeLeft: '\u2524',
  },
  double: {
    topLeft: '\u2554',
    topRight: '\u2557',
    bottomLeft: '\u255a',
    bottomRight: '\u255d',
    horizontal: '\u2550',
    vertical: '\u2551',
    cross: '\u256c',
    teeDown: '\u2566',
    teeUp: '\u2569',
    teeRight: '\u2560',
    teeLeft: '\u2563',
  },
  rounded: {
    topLeft: '\u256d',
    topRight: '\u256e',
    bottomLeft: '\u2570',
    bottomRight: '\u256f',
    horizontal: '\u2500',
    vertical: '\u2502',
    cross: '\u253c',
    teeDown: '\u252c',
    teeUp: '\u2534',
    teeRight: '\u251c',
    teeLeft: '\u2524',
  },
  ascii: {
    topLeft: '+',
    topRight: '+',
    bottomLeft: '+',
    bottomRight: '+',
    horizontal: '-',
    vertical: '|',
    cross: '+',
    teeDown: '+',
    teeUp: '+',
    teeRight: '+',
    teeLeft: '+',
  },
} as const

// Spinner frames for animated progress
const SPINNER_FRAMES = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f']
const SPINNER_FRAMES_ASCII = ['|', '/', '-', '\\']

// Progress bar characters
const PROGRESS = {
  filled: '\u2588',
  empty: '\u2591',
  filledAscii: '#',
  emptyAscii: '-',
} as const

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Strip ANSI codes from a string
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Get visible length of a string (excluding ANSI codes)
 */
function visibleLength(str: string): string['length'] {
  return stripAnsi(str).length
}

/**
 * Pad a string to a specific width
 */
function pad(str: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  const visible = visibleLength(str)
  if (visible >= width) return str

  const padding = width - visible

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str
    case 'center': {
      const left = Math.floor(padding / 2)
      const right = padding - left
      return ' '.repeat(left) + str + ' '.repeat(right)
    }
    default:
      return str + ' '.repeat(padding)
  }
}

/**
 * Truncate a string to a maximum width
 */
function truncate(str: string, maxWidth: number, ellipsis = '\u2026'): string {
  if (visibleLength(str) <= maxWidth) return str

  const stripped = stripAnsi(str)
  return stripped.slice(0, maxWidth - ellipsis.length) + ellipsis
}

/**
 * Wrap text to a maximum width
 */
function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += ' ' + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines
}

// ============================================================================
// BADGE RENDERER
// ============================================================================

/**
 * Render a badge/tag with optional variant styling
 */
export function renderBadge(
  text: string,
  variant: BadgeVariant = 'default',
  options: RenderOptions = { tier: 'text' }
): string {
  const { tier } = options

  switch (tier) {
    case 'ansi': {
      const colors: Record<BadgeVariant, string> = {
        default: `${ANSI.bgWhite}${ANSI.black}`,
        success: `${ANSI.bgGreen}${ANSI.white}`,
        warning: `${ANSI.bgYellow}${ANSI.black}`,
        error: `${ANSI.bgRed}${ANSI.white}`,
        info: `${ANSI.bgBlue}${ANSI.white}`,
      }
      return `${colors[variant]} ${text} ${ANSI.reset}`
    }

    case 'markdown': {
      const prefixes: Record<BadgeVariant, string> = {
        default: '',
        success: '[OK] ',
        warning: '[WARN] ',
        error: '[ERROR] ',
        info: '[INFO] ',
      }
      return `\`${prefixes[variant]}${text}\``
    }

    default:
      return `[${text}]`
  }
}

// ============================================================================
// PROGRESS RENDERER
// ============================================================================

/**
 * Render a progress bar
 */
export function renderProgress(
  percent: number,
  label?: string,
  options: ProgressOptions = { tier: 'text' }
): string {
  const { tier, barWidth = 20, showPercentage = true } = options
  const clampedPercent = Math.max(0, Math.min(100, percent))
  const filledCount = Math.round((clampedPercent / 100) * barWidth)

  switch (tier) {
    case 'ansi': {
      const filled = PROGRESS.filled.repeat(filledCount)
      const empty = PROGRESS.empty.repeat(barWidth - filledCount)
      const bar = `${ANSI.green}${filled}${ANSI.gray}${empty}${ANSI.reset}`
      const percentStr = showPercentage ? ` ${clampedPercent.toFixed(0)}%` : ''
      const labelStr = label ? `${label} ` : ''
      return `${labelStr}[${bar}]${percentStr}`
    }

    case 'markdown': {
      // Markdown doesn't support true progress bars, use text representation
      const filled = '\u2588'.repeat(filledCount)
      const empty = '\u2591'.repeat(barWidth - filledCount)
      const percentStr = showPercentage ? ` ${clampedPercent.toFixed(0)}%` : ''
      const labelStr = label ? `**${label}** ` : ''
      return `${labelStr}\`[${filled}${empty}]\`${percentStr}`
    }

    default: {
      const filled = PROGRESS.filledAscii.repeat(filledCount)
      const empty = PROGRESS.emptyAscii.repeat(barWidth - filledCount)
      const percentStr = showPercentage ? ` ${clampedPercent.toFixed(0)}%` : ''
      const labelStr = label ? `${label} ` : ''
      return `${labelStr}[${filled}${empty}]${percentStr}`
    }
  }
}

// ============================================================================
// SPINNER RENDERER
// ============================================================================

/**
 * Render a spinner frame
 */
export function renderSpinner(
  label?: string,
  options: SpinnerOptions = { tier: 'text' }
): string {
  const { tier, frame = 0 } = options

  switch (tier) {
    case 'ansi': {
      const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
      const labelStr = label ? ` ${label}` : ''
      return `${ANSI.cyan}${spinnerChar}${ANSI.reset}${labelStr}`
    }

    case 'markdown': {
      const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
      const labelStr = label ? ` ${label}` : ''
      return `${spinnerChar}${labelStr}`
    }

    default: {
      const spinnerChar = SPINNER_FRAMES_ASCII[frame % SPINNER_FRAMES_ASCII.length]
      const labelStr = label ? ` ${label}` : ''
      return `${spinnerChar}${labelStr}`
    }
  }
}

// ============================================================================
// PANEL RENDERER
// ============================================================================

/**
 * Render a bordered panel with title and content
 */
export function renderPanel(
  title: string,
  content: string,
  options: PanelOptions = { tier: 'text' }
): string {
  const { tier, width = 60, border = 'single', padding = 1 } = options
  const innerWidth = width - 2 - (padding * 2)

  switch (tier) {
    case 'ansi': {
      const box = BOX[border === 'none' ? 'single' : border]
      const lines: string[] = []

      // Top border with title
      const titleDisplay = title ? ` ${title} ` : ''
      const titlePadding = box.horizontal.repeat(Math.max(0, (innerWidth - titleDisplay.length) / 2))
      lines.push(
        `${ANSI.cyan}${box.topLeft}${titlePadding}${ANSI.bold}${titleDisplay}${ANSI.reset}${ANSI.cyan}${titlePadding}${box.topRight}${ANSI.reset}`
      )

      // Padding line
      if (padding > 0) {
        lines.push(`${ANSI.cyan}${box.vertical}${ANSI.reset}${' '.repeat(innerWidth + padding * 2)}${ANSI.cyan}${box.vertical}${ANSI.reset}`)
      }

      // Content lines
      const wrappedContent = wordWrap(content, innerWidth)
      for (const line of wrappedContent) {
        const paddedLine = ' '.repeat(padding) + pad(line, innerWidth, 'left') + ' '.repeat(padding)
        lines.push(`${ANSI.cyan}${box.vertical}${ANSI.reset}${paddedLine}${ANSI.cyan}${box.vertical}${ANSI.reset}`)
      }

      // Padding line
      if (padding > 0) {
        lines.push(`${ANSI.cyan}${box.vertical}${ANSI.reset}${' '.repeat(innerWidth + padding * 2)}${ANSI.cyan}${box.vertical}${ANSI.reset}`)
      }

      // Bottom border
      lines.push(
        `${ANSI.cyan}${box.bottomLeft}${box.horizontal.repeat(innerWidth + padding * 2)}${box.bottomRight}${ANSI.reset}`
      )

      return lines.join('\n')
    }

    case 'markdown': {
      const lines: string[] = []

      if (title) {
        lines.push(`### ${title}`)
        lines.push('')
      }

      lines.push('> ' + content.split('\n').join('\n> '))

      return lines.join('\n')
    }

    default: {
      const box = BOX.ascii
      const lines: string[] = []

      // Top border with title
      const titleDisplay = title ? ` ${title} ` : ''
      const titlePadding = box.horizontal.repeat(Math.max(0, Math.floor((innerWidth - titleDisplay.length) / 2)))
      lines.push(`${box.topLeft}${titlePadding}${titleDisplay}${titlePadding}${box.topRight}`)

      // Content lines
      const wrappedContent = wordWrap(content, innerWidth)
      for (const line of wrappedContent) {
        const paddedLine = ' '.repeat(padding) + pad(line, innerWidth, 'left') + ' '.repeat(padding)
        lines.push(`${box.vertical}${paddedLine}${box.vertical}`)
      }

      // Bottom border
      lines.push(`${box.bottomLeft}${box.horizontal.repeat(innerWidth + padding * 2)}${box.bottomRight}`)

      return lines.join('\n')
    }
  }
}

// ============================================================================
// TABLE RENDERER
// ============================================================================

/**
 * Auto-detect columns from data
 */
function autoDetectColumns(data: Record<string, unknown>[]): TableColumn[] {
  if (data.length === 0) return []

  const keys = new Set<string>()
  for (const row of data) {
    for (const key of Object.keys(row)) {
      keys.add(key)
    }
  }

  return Array.from(keys).map((key) => ({
    header: key,
    key,
  }))
}

/**
 * Calculate column widths based on content
 */
function calculateColumnWidths(
  data: Record<string, unknown>[],
  columns: TableColumn[],
  maxWidth: number
): number[] {
  const widths = columns.map((col) => {
    // Start with header width
    let maxColWidth = col.header.length

    // Check all data values
    for (const row of data) {
      const value = String(row[col.key] ?? '')
      maxColWidth = Math.max(maxColWidth, value.length)
    }

    return col.width ?? Math.min(maxColWidth, 40)
  })

  // Adjust if total exceeds maxWidth
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (columns.length + 1) * 3
  if (totalWidth > maxWidth) {
    const scale = maxWidth / totalWidth
    return widths.map((w) => Math.max(3, Math.floor(w * scale)))
  }

  return widths
}

/**
 * Render data as a table
 */
export function renderTable(
  data: Record<string, unknown>[],
  options: TableOptions = { tier: 'text' }
): string {
  if (data.length === 0) {
    return options.tier === 'markdown' ? '_No data_' : '(no data)'
  }

  const {
    tier,
    columns = autoDetectColumns(data),
    showHeaders = true,
    maxRows,
    border = 'unicode',
    width = 80,
  } = options

  const displayData = maxRows && data.length > maxRows ? data.slice(0, maxRows) : data
  const truncated = maxRows && data.length > maxRows
  const colWidths = calculateColumnWidths(data, columns, width)

  switch (tier) {
    case 'ansi': {
      const box = border === 'ascii' ? BOX.ascii : BOX.single
      const lines: string[] = []

      // Top border
      const topBorder = columns.map((_, i) => box.horizontal.repeat(colWidths[i] + 2)).join(box.teeDown)
      lines.push(`${ANSI.gray}${box.topLeft}${topBorder}${box.topRight}${ANSI.reset}`)

      // Header row
      if (showHeaders) {
        const headerCells = columns.map((col, i) =>
          ` ${ANSI.bold}${pad(truncate(col.header, colWidths[i]), colWidths[i], col.align)}${ANSI.reset} `
        )
        lines.push(`${ANSI.gray}${box.vertical}${ANSI.reset}${headerCells.join(`${ANSI.gray}${box.vertical}${ANSI.reset}`)}${ANSI.gray}${box.vertical}${ANSI.reset}`)

        // Header separator
        const sepBorder = columns.map((_, i) => box.horizontal.repeat(colWidths[i] + 2)).join(box.cross)
        lines.push(`${ANSI.gray}${box.teeRight}${sepBorder}${box.teeLeft}${ANSI.reset}`)
      }

      // Data rows
      for (const row of displayData) {
        const cells = columns.map((col, i) => {
          const value = String(row[col.key] ?? '')
          return ` ${pad(truncate(value, colWidths[i]), colWidths[i], col.align)} `
        })
        lines.push(`${ANSI.gray}${box.vertical}${ANSI.reset}${cells.join(`${ANSI.gray}${box.vertical}${ANSI.reset}`)}${ANSI.gray}${box.vertical}${ANSI.reset}`)
      }

      // Bottom border
      const bottomBorder = columns.map((_, i) => box.horizontal.repeat(colWidths[i] + 2)).join(box.teeUp)
      lines.push(`${ANSI.gray}${box.bottomLeft}${bottomBorder}${box.bottomRight}${ANSI.reset}`)

      // Truncation notice
      if (truncated) {
        lines.push(`${ANSI.dim}... and ${data.length - maxRows!} more rows${ANSI.reset}`)
      }

      return lines.join('\n')
    }

    case 'markdown': {
      const lines: string[] = []

      // Header row
      if (showHeaders) {
        lines.push('| ' + columns.map((col) => col.header).join(' | ') + ' |')
        lines.push('| ' + columns.map((col) => {
          const align = col.align ?? 'left'
          if (align === 'center') return ':---:'
          if (align === 'right') return '---:'
          return '---'
        }).join(' | ') + ' |')
      }

      // Data rows
      for (const row of displayData) {
        const cells = columns.map((col) => String(row[col.key] ?? '').replace(/\|/g, '\\|'))
        lines.push('| ' + cells.join(' | ') + ' |')
      }

      // Truncation notice
      if (truncated) {
        lines.push('')
        lines.push(`_... and ${data.length - maxRows!} more rows_`)
      }

      return lines.join('\n')
    }

    default: {
      const lines: string[] = []

      // Simple text table with aligned columns
      if (showHeaders) {
        const headerLine = columns.map((col, i) =>
          pad(truncate(col.header, colWidths[i]), colWidths[i], col.align)
        ).join('  ')
        lines.push(headerLine)
        lines.push('-'.repeat(headerLine.length))
      }

      for (const row of displayData) {
        const cells = columns.map((col, i) => {
          const value = String(row[col.key] ?? '')
          return pad(truncate(value, colWidths[i]), colWidths[i], col.align)
        })
        lines.push(cells.join('  '))
      }

      if (truncated) {
        lines.push(`... and ${data.length - maxRows!} more rows`)
      }

      return lines.join('\n')
    }
  }
}

// ============================================================================
// TIER DETECTION
// ============================================================================

/**
 * Detect the appropriate rendering tier based on request headers
 */
export function detectTier(request: Request): RenderTier {
  const url = new URL(request.url)

  // Check query parameter override
  const tierParam = url.searchParams.get('tier') || url.searchParams.get('format')
  if (tierParam === 'text' || tierParam === 'markdown' || tierParam === 'ansi') {
    return tierParam
  }

  // Check Accept header
  const accept = request.headers.get('Accept') || ''

  // ANSI tier for terminal clients
  if (accept.includes('text/x-ansi') || accept.includes('application/x-ansi')) {
    return 'ansi'
  }

  // Markdown tier for MCP clients and AI agents
  if (accept.includes('text/markdown') || accept.includes('text/x-markdown')) {
    return 'markdown'
  }

  // Check User-Agent for terminal clients (case-insensitive)
  const userAgent = (request.headers.get('User-Agent') || '').toLowerCase()
  if (
    userAgent.includes('curl') ||
    userAgent.includes('wget') ||
    userAgent.includes('httpie') ||
    userAgent.includes('xterm') ||
    userAgent.includes('terminal')
  ) {
    return 'ansi'
  }

  // Check for MCP client header
  const mcpClient = request.headers.get('X-MCP-Client')
  if (mcpClient) {
    return 'markdown'
  }

  // Default to text for maximum compatibility
  return 'text'
}

/**
 * Detect terminal capabilities from request
 */
export function detectCapabilities(request: Request): RenderOptions {
  const tier = detectTier(request)
  const url = new URL(request.url)

  // Parse width from query or header
  const widthParam = url.searchParams.get('width')
  const widthHeader = request.headers.get('X-Terminal-Width')
  const width = widthParam ? parseInt(widthParam, 10) :
                widthHeader ? parseInt(widthHeader, 10) :
                80

  // Parse color depth from query or header
  const colorParam = url.searchParams.get('colors')
  const colorHeader = request.headers.get('X-Terminal-Colors')
  const colorDepth = colorParam ? parseInt(colorParam, 10) :
                     colorHeader ? parseInt(colorHeader, 10) :
                     tier === 'ansi' ? 256 : 0

  return {
    tier,
    width: Math.max(40, Math.min(200, width)),
    colorDepth,
    useUnicode: tier !== 'text',
  }
}

// ============================================================================
// TERMINAL RENDERER CLASS
// ============================================================================

/**
 * Terminal renderer with multi-tier support
 */
export class TerminalRenderer {
  private options: RenderOptions

  constructor(options: Partial<RenderOptions> = {}) {
    this.options = {
      tier: options.tier ?? 'text',
      width: options.width ?? 80,
      colorDepth: options.colorDepth ?? 0,
      useUnicode: options.useUnicode ?? false,
    }
  }

  /**
   * Create a renderer from a request
   */
  static fromRequest(request: Request): TerminalRenderer {
    return new TerminalRenderer(detectCapabilities(request))
  }

  /**
   * Get the current rendering tier
   */
  get tier(): RenderTier {
    return this.options.tier
  }

  /**
   * Render a table from data
   */
  renderTable(data: Record<string, unknown>[], tableOptions?: Partial<TableOptions>): string {
    return renderTable(data, { ...this.options, ...tableOptions })
  }

  /**
   * Render a progress bar
   */
  renderProgress(percent: number, label?: string, progressOptions?: Partial<ProgressOptions>): string {
    return renderProgress(percent, label, { ...this.options, ...progressOptions })
  }

  /**
   * Render a panel with title and content
   */
  renderPanel(title: string, content: string, panelOptions?: Partial<PanelOptions>): string {
    return renderPanel(title, content, { ...this.options, ...panelOptions })
  }

  /**
   * Render a badge
   */
  renderBadge(text: string, variant?: BadgeVariant): string {
    return renderBadge(text, variant, this.options)
  }

  /**
   * Render a spinner frame
   */
  renderSpinner(label?: string, frame?: number): string {
    return renderSpinner(label, { ...this.options, frame })
  }

  /**
   * Render structured command output
   */
  renderCommandOutput(result: {
    command: string
    exitCode: number
    stdout: string
    stderr: string
    duration?: number
  }): string {
    const { tier } = this.options
    const { command, exitCode, stdout, stderr, duration } = result
    const success = exitCode === 0

    switch (tier) {
      case 'ansi': {
        const lines: string[] = []

        // Command header
        const statusBadge = success
          ? `${ANSI.bgGreen}${ANSI.white} OK ${ANSI.reset}`
          : `${ANSI.bgRed}${ANSI.white} FAIL ${ANSI.reset}`
        const durationStr = duration ? ` ${ANSI.dim}(${duration}ms)${ANSI.reset}` : ''
        lines.push(`${statusBadge} ${ANSI.bold}$ ${command}${ANSI.reset}${durationStr}`)
        lines.push('')

        // Output
        if (stdout) {
          lines.push(stdout)
        }
        if (stderr) {
          lines.push(`${ANSI.red}${stderr}${ANSI.reset}`)
        }

        return lines.join('\n')
      }

      case 'markdown': {
        const lines: string[] = []

        const statusBadge = success ? '[OK]' : '[FAIL]'
        const durationStr = duration ? ` _(${duration}ms)_` : ''
        lines.push(`${statusBadge} \`$ ${command}\`${durationStr}`)
        lines.push('')

        if (stdout) {
          lines.push('```')
          lines.push(stdout)
          lines.push('```')
        }
        if (stderr) {
          lines.push('')
          lines.push('**stderr:**')
          lines.push('```')
          lines.push(stderr)
          lines.push('```')
        }

        return lines.join('\n')
      }

      default: {
        const lines: string[] = []

        const statusBadge = success ? '[OK]' : '[FAIL]'
        const durationStr = duration ? ` (${duration}ms)` : ''
        lines.push(`${statusBadge} $ ${command}${durationStr}`)
        lines.push('')

        if (stdout) {
          lines.push(stdout)
        }
        if (stderr) {
          lines.push('')
          lines.push('stderr:')
          lines.push(stderr)
        }

        return lines.join('\n')
      }
    }
  }
}

// ============================================================================
// STREAMING RENDERER FOR DURABLE OBJECTS
// ============================================================================

/**
 * Event types for streaming updates
 */
export type StreamEvent =
  | { type: 'start'; command: string; tier: RenderTier }
  | { type: 'output'; content: string; stream: 'stdout' | 'stderr' }
  | { type: 'progress'; percent: number; label?: string }
  | { type: 'table'; data: Record<string, unknown>[] }
  | { type: 'end'; exitCode: number; duration?: number }
  | { type: 'error'; message: string }

/**
 * Callback type for streaming events
 */
export type StreamCallback = (event: StreamEvent) => void

/**
 * Streaming renderer for Durable Object integration.
 * Wraps TerminalRenderer with streaming capabilities for real-time updates.
 *
 * @example WebSocket integration in a DO
 * ```typescript
 * class ShellDO extends DurableObject {
 *   async handleWebSocket(request: Request): Promise<Response> {
 *     const renderer = StreamingRenderer.fromRequest(request, (event) => {
 *       this.broadcast(JSON.stringify(event))
 *     })
 *
 *     // When command starts
 *     renderer.start('ls -la')
 *
 *     // Stream output chunks
 *     renderer.output('file1.txt\n', 'stdout')
 *     renderer.output('file2.txt\n', 'stdout')
 *
 *     // When complete
 *     renderer.end(0, 50)
 *   }
 * }
 * ```
 */
export class StreamingRenderer {
  private renderer: TerminalRenderer
  private callback: StreamCallback
  private spinnerFrame: number = 0
  private spinnerInterval?: ReturnType<typeof setInterval>

  constructor(options: Partial<RenderOptions> = {}, callback: StreamCallback) {
    this.renderer = new TerminalRenderer(options)
    this.callback = callback
  }

  /**
   * Create a streaming renderer from a request
   */
  static fromRequest(request: Request, callback: StreamCallback): StreamingRenderer {
    const options = detectCapabilities(request)
    return new StreamingRenderer(options, callback)
  }

  /**
   * Get the current rendering tier
   */
  get tier(): RenderTier {
    return this.renderer.tier
  }

  /**
   * Signal command execution start
   */
  start(command: string): void {
    this.callback({
      type: 'start',
      command,
      tier: this.renderer.tier,
    })
  }

  /**
   * Stream an output chunk
   */
  output(content: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    this.callback({
      type: 'output',
      content,
      stream,
    })
  }

  /**
   * Emit progress update
   */
  progress(percent: number, label?: string): void {
    this.callback({
      type: 'progress',
      percent,
      label,
    })
  }

  /**
   * Emit table data
   */
  table(data: Record<string, unknown>[]): void {
    this.callback({
      type: 'table',
      data,
    })
  }

  /**
   * Signal command completion
   */
  end(exitCode: number, duration?: number): void {
    this.stopSpinner()
    this.callback({
      type: 'end',
      exitCode,
      duration,
    })
  }

  /**
   * Signal an error
   */
  error(message: string): void {
    this.stopSpinner()
    this.callback({
      type: 'error',
      message,
    })
  }

  /**
   * Start a spinner animation (for long-running operations)
   * Emits progress events at the specified interval
   */
  startSpinner(label: string, intervalMs: number = 100): void {
    this.spinnerFrame = 0
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length
      // Emit as progress with negative percent to indicate "indeterminate"
      this.callback({
        type: 'progress',
        percent: -1,
        label: `${label} ${this.spinnerFrame}`,
      })
    }, intervalMs)
  }

  /**
   * Stop the spinner animation
   */
  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = undefined
    }
  }

  /**
   * Render a complete command result as a single output
   */
  renderResult(result: {
    command: string
    exitCode: number
    stdout: string
    stderr: string
    duration?: number
  }): string {
    return this.renderer.renderCommandOutput(result)
  }

  /**
   * Render table data
   */
  renderTable(data: Record<string, unknown>[], options?: Partial<TableOptions>): string {
    return this.renderer.renderTable(data, options)
  }

  /**
   * Render progress bar
   */
  renderProgress(percent: number, label?: string, options?: Partial<ProgressOptions>): string {
    return this.renderer.renderProgress(percent, label, options)
  }

  /**
   * Render panel
   */
  renderPanel(title: string, content: string, options?: Partial<PanelOptions>): string {
    return this.renderer.renderPanel(title, content, options)
  }

  /**
   * Get the underlying TerminalRenderer
   */
  getRenderer(): TerminalRenderer {
    return this.renderer
  }
}

// ============================================================================
// DO INTEGRATION HELPERS
// ============================================================================

/**
 * Create a StreamCallback that sends events over WebSocket
 */
export function createWebSocketCallback(ws: WebSocket): StreamCallback {
  return (event: StreamEvent) => {
    try {
      ws.send(JSON.stringify(event))
    } catch {
      // WebSocket may be closed
    }
  }
}

/**
 * Create a StreamCallback that buffers events for later retrieval
 */
export function createBufferedCallback(): {
  callback: StreamCallback
  getEvents: () => StreamEvent[]
  clear: () => void
} {
  const events: StreamEvent[] = []
  return {
    callback: (event: StreamEvent) => events.push(event),
    getEvents: () => [...events],
    clear: () => (events.length = 0),
  }
}

/**
 * Render stream events to a string (for non-streaming contexts like MCP)
 */
export function renderStreamEvents(
  events: StreamEvent[],
  options: RenderOptions = { tier: 'text' }
): string {
  const renderer = new TerminalRenderer(options)
  const lines: string[] = []

  for (const event of events) {
    switch (event.type) {
      case 'start':
        if (options.tier === 'ansi') {
          lines.push(`${ANSI.dim}$ ${event.command}${ANSI.reset}`)
        } else if (options.tier === 'markdown') {
          lines.push(`\`$ ${event.command}\``)
        } else {
          lines.push(`$ ${event.command}`)
        }
        break

      case 'output':
        if (event.stream === 'stderr' && options.tier === 'ansi') {
          lines.push(`${ANSI.red}${event.content}${ANSI.reset}`)
        } else {
          lines.push(event.content)
        }
        break

      case 'progress':
        if (event.percent >= 0) {
          lines.push(renderer.renderProgress(event.percent, event.label))
        }
        break

      case 'table':
        lines.push(renderer.renderTable(event.data))
        break

      case 'end': {
        const badge = event.exitCode === 0
          ? renderer.renderBadge('OK', 'success')
          : renderer.renderBadge(`EXIT ${event.exitCode}`, 'error')
        const durationStr = event.duration ? ` (${event.duration}ms)` : ''
        lines.push(`${badge}${durationStr}`)
        break
      }

      case 'error':
        if (options.tier === 'ansi') {
          lines.push(`${ANSI.red}Error: ${event.message}${ANSI.reset}`)
        } else if (options.tier === 'markdown') {
          lines.push(`**Error:** ${event.message}`)
        } else {
          lines.push(`Error: ${event.message}`)
        }
        break
    }
  }

  return lines.join('\n')
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  stripAnsi,
  visibleLength,
  pad,
  truncate,
  wordWrap,
  ANSI,
  BOX,
  SPINNER_FRAMES,
  PROGRESS,
}
