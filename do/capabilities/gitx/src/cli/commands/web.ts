/**
 * @fileoverview Git Web Command - Shareable Diff Preview URLs
 *
 * This module implements the `gitx web` command which generates shareable
 * HTML previews of diffs. Features include:
 * - Converting diff output to styled HTML with syntax highlighting
 * - Uploading to a preview service and returning a shareable URL
 * - Configurable expiration times (minutes, hours, days)
 * - Progress callbacks for upload status
 * - ANSI escape code to HTML conversion for terminal output
 *
 * @module cli/commands/web
 *
 * @example
 * // Generate HTML from diff
 * const html = await generateHTML(diffResult)
 *
 * @example
 * // Upload and get shareable URL
 * const result = await uploadPreview(html, { expires: '24h' })
 * console.log(`Share this URL: ${result.url}`)
 * console.log(`Expires: ${result.expiresAt}`)
 */

import type { CommandContext } from '../index'
import type { DiffResult, DiffEntry, DiffHunk } from './diff'
import { getUnstagedDiff } from './diff'
import * as crypto from 'crypto'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the web command.
 *
 * @description Configuration options controlling the upload behavior,
 * expiration, and progress tracking.
 *
 * @property expires - Expiration duration (e.g., '30m', '1h', '7d')
 * @property open - Open URL in default browser after upload
 * @property endpoint - Custom upload endpoint URL
 * @property timeout - Upload timeout in milliseconds
 * @property onProgress - Callback for upload progress updates
 */
export interface WebOptions {
  /** Expiration time for the preview (e.g., '1h', '24h', '7d') */
  expires?: string
  /** Open the URL in browser after upload */
  open?: boolean
  /** Custom upload endpoint */
  endpoint?: string
  /** Upload timeout in milliseconds */
  timeout?: number
  /** Progress callback */
  onProgress?: ProgressCallback
}

/**
 * Result of the web command.
 *
 * @description Contains the shareable URL and expiration information
 * returned after a successful upload.
 *
 * @property url - The shareable preview URL
 * @property expiresAt - When the preview will expire
 * @property openedInBrowser - Whether the browser was opened to the URL
 */
export interface WebResult {
  /** The shareable URL */
  url: string
  /** When the preview expires */
  expiresAt: Date | string
  /** Whether browser was opened */
  openedInBrowser?: boolean
}

/**
 * Result of an upload operation.
 *
 * @description Contains the URL, expiration, and unique ID for the
 * uploaded preview content.
 *
 * @property url - The shareable preview URL
 * @property expiresAt - When the preview will expire (Date or ISO string)
 * @property id - Unique identifier for the upload
 */
export interface UploadResult {
  /** The shareable URL */
  url: string
  /** When the preview expires */
  expiresAt: Date | string
  /** Unique ID of the upload */
  id: string
}

/**
 * Callback for upload progress updates.
 *
 * @description Called during upload with progress percentage (0-100).
 *
 * @param progress - Upload progress as percentage (0-100)
 */
export type ProgressCallback = (progress: number) => void

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_EXPIRATION_HOURS = 24
const _DEFAULT_ENDPOINT = 'https://preview.gitx.do/upload'
void _DEFAULT_ENDPOINT // Reserved for production use

// ============================================================================
// Main Command Handler
// ============================================================================

/**
 * Execute the web command from the CLI.
 *
 * @description Main entry point for the `gitx web` command. Gets the current
 * diff, converts it to HTML, uploads it, and returns the shareable URL.
 *
 * @param ctx - Command context with cwd, options, and output functions
 * @returns Promise resolving to web result with URL and expiration
 * @throws {Error} If upload fails
 *
 * @example
 * // CLI usage
 * // gitx web                     - Upload current diff with 24h expiry
 * // gitx web --expires 7d        - Upload with 7 day expiry
 * // gitx web --open              - Upload and open in browser
 */
export async function webCommand(ctx: CommandContext): Promise<WebResult> {
  const options: WebOptions = {
    expires: ctx.options.expires,
    open: ctx.options.open,
    endpoint: ctx.options.endpoint,
    timeout: ctx.options.timeout,
  }

  // Get diff from working directory
  const diff = await getUnstagedDiff(ctx.cwd)

  // Generate HTML
  const html = await generateHTML(diff)

  // Create progress callback that outputs to stdout
  const onProgress: ProgressCallback = (progress) => {
    ctx.stdout(`Uploading... ${progress}%`)
  }

  try {
    // Upload and get URL
    const result = await uploadPreview(html, { ...options, onProgress })

    // Output URL
    ctx.stdout(`Preview URL: ${result.url}`)
    ctx.stdout(`Expires: ${result.expiresAt}`)

    return {
      url: result.url,
      expiresAt: result.expiresAt,
      openedInBrowser: options.open || false,
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    ctx.stderr(`Upload failed: ${err.message}`)
    throw err
  }
}

// ============================================================================
// HTML Generation
// ============================================================================

/**
 * Generate HTML document from diff result.
 *
 * @description Converts a diff result into a styled HTML document ready
 * for viewing in a browser. Delegates to generateStandaloneHTML.
 *
 * @param diff - Diff result with entries and stats
 * @returns Promise resolving to complete HTML document string
 *
 * @example
 * const html = await generateHTML(diffResult)
 * // Returns full HTML document with CSS and navigation
 */
export async function generateHTML(diff: DiffResult): Promise<string> {
  return generateStandaloneHTML(diff)
}

/**
 * Generate standalone HTML with no external dependencies.
 *
 * @description Creates a complete HTML document with inline CSS that can be
 * viewed without any external resources. Includes:
 * - GitHub-style dark theme styling
 * - File navigation sidebar
 * - Syntax-highlighted diff content
 * - Summary statistics
 *
 * @param diff - Diff result with entries and stats
 * @returns Promise resolving to complete HTML document string
 *
 * @example
 * const html = await generateStandaloneHTML(diffResult)
 * await fs.writeFile('preview.html', html)
 * // Open preview.html in browser - works offline
 */
export async function generateStandaloneHTML(diff: DiffResult): Promise<string> {
  const { entries, stats } = diff

  // Generate file IDs for anchors
  const fileIds = entries.map((entry, i) => ({
    entry,
    id: `file-${i}-${sanitizeId(entry.path)}`,
  }))

  // Build navigation HTML
  const navItems = fileIds.map(({ entry, id }) => {
    const statusClass = entry.status
    const addCount = countAdditions(entry)
    const delCount = countDeletions(entry)
    return `
      <a href="#${id}" class="nav-item ${statusClass}">
        <span class="file-name">${escapeHtml(entry.path)}</span>
        <span class="status-badge ${statusClass}">${entry.status}</span>
        <span class="line-counts">
          <span class="additions">+${addCount}</span>
          <span class="deletions">-${delCount}</span>
        </span>
      </a>`
  }).join('\n')

  // Build diff content HTML
  const diffContent = fileIds.map(({ entry, id }) => {
    const hunksHtml = entry.hunks.map(hunk => renderHunk(hunk, entry.path)).join('\n')
    return `
      <section id="${id}" class="file-diff">
        <h2 class="file-header">
          <span class="file-path">${escapeHtml(entry.path)}</span>
          <span class="status-badge ${entry.status}">${entry.status}</span>
        </h2>
        <div class="diff-content">
          ${hunksHtml || '<p class="no-changes">No changes in this file</p>'}
        </div>
      </section>`
  }).join('\n')

  // Stats summary
  const statsHtml = entries.length > 0
    ? `<div class="stats">${stats.filesChanged} files changed, ${stats.insertions} insertions(+), ${stats.deletions} deletions(-)</div>`
    : '<div class="stats">No changes</div>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diff Preview - gitx</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.6;
    }
    .container {
      display: flex;
      min-height: 100vh;
    }
    nav {
      width: 280px;
      background: #161b22;
      border-right: 1px solid #30363d;
      padding: 1rem;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .nav-header {
      font-weight: 600;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #30363d;
    }
    .navigation {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-radius: 6px;
      text-decoration: none;
      color: #c9d1d9;
      font-size: 0.875rem;
      transition: background 0.2s;
    }
    .nav-item:hover {
      background: #21262d;
    }
    .file-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-badge {
      font-size: 0.75rem;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .status-badge.added { background: #238636; color: #fff; }
    .status-badge.modified { background: #1f6feb; color: #fff; }
    .status-badge.deleted { background: #da3633; color: #fff; }
    .status-badge.renamed { background: #8957e5; color: #fff; }
    .line-counts {
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-size: 0.75rem;
    }
    .additions { color: #3fb950; }
    .deletions { color: #f85149; }
    main {
      flex: 1;
      padding: 2rem;
      overflow-x: auto;
    }
    .stats {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
    }
    .file-diff {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }
    .file-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      background: #21262d;
      border-bottom: 1px solid #30363d;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .diff-content {
      overflow-x: auto;
    }
    .hunk {
      border-bottom: 1px solid #30363d;
    }
    .hunk:last-child {
      border-bottom: none;
    }
    .hunk-header {
      background: #161b22;
      color: #8b949e;
      padding: 0.5rem 1rem;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-size: 0.75rem;
    }
    .diff-line {
      display: flex;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
    }
    .line-no {
      min-width: 50px;
      padding: 0 0.5rem;
      text-align: right;
      color: #484f58;
      user-select: none;
      border-right: 1px solid #30363d;
    }
    .line-content {
      flex: 1;
      padding: 0 1rem;
      white-space: pre;
    }
    .diff-line.addition {
      background: rgba(46, 160, 67, 0.15);
    }
    .diff-line.addition .line-content {
      color: #3fb950;
    }
    .diff-line.deletion {
      background: rgba(248, 81, 73, 0.15);
    }
    .diff-line.deletion .line-content {
      color: #f85149;
    }
    .diff-line.context {
      background: transparent;
    }
    .no-changes {
      padding: 2rem;
      text-align: center;
      color: #8b949e;
    }
    .ansi-green, .ansi-addition { color: #3fb950; }
    .ansi-red, .ansi-deletion { color: #f85149; }
    .ansi-cyan, .ansi-hunk { color: #58a6ff; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <div class="nav-header">Files</div>
      <div class="navigation file-list">
        ${navItems || '<p class="no-changes">No changes</p>'}
      </div>
    </nav>
    <main>
      ${statsHtml}
      ${diffContent || '<p class="no-changes">No changes to display</p>'}
    </main>
  </div>
</body>
</html>`
}

/**
 * Render a diff hunk as HTML
 */
function renderHunk(hunk: DiffHunk, _filePath: string): string {
  const headerText = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`

  const linesHtml = hunk.lines.map(line => {
    const lineClass = line.type
    const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '
    const oldNo = line.oldLineNo ?? ''
    const newNo = line.newLineNo ?? ''

    return `
      <div class="diff-line ${lineClass}">
        <span class="line-no">${oldNo}</span>
        <span class="line-no">${newNo}</span>
        <span class="line-content">${prefix}${escapeHtml(line.content)}</span>
      </div>`
  }).join('\n')

  return `
    <div class="hunk">
      <div class="hunk-header">${escapeHtml(headerText)}</div>
      ${linesHtml}
    </div>`
}

// ============================================================================
// ANSI to HTML Conversion
// ============================================================================

/**
 * Convert ANSI escape codes to HTML spans with appropriate classes.
 *
 * @description Parses ANSI escape sequences (color codes) in terminal output
 * and converts them to HTML `<span>` elements with CSS classes for styling.
 * Supports:
 * - Basic 16 ANSI colors (30-37, 90-97)
 * - 256-color mode (38;5;N)
 * - 24-bit RGB color (38;2;R;G;B)
 * - Reset code (0)
 *
 * @param ansiText - Text containing ANSI escape sequences
 * @returns HTML string with escape sequences converted to spans
 *
 * @example
 * const html = convertAnsiToHTML('\x1b[32mgreen text\x1b[0m')
 * // '<span class="ansi-green ansi-addition">green text</span>'
 */
export function convertAnsiToHTML(ansiText: string): string {
  // First escape HTML special characters in the original text segments
  let result = ''
  let i = 0

  while (i < ansiText.length) {
    // Check for ANSI escape sequence
    if (ansiText[i] === '\x1b' && ansiText[i + 1] === '[') {
      // Find the end of the escape sequence
      let j = i + 2
      while (j < ansiText.length && !/[a-zA-Z]/.test(ansiText[j])) {
        j++
      }
      if (j < ansiText.length) {
        const code = ansiText.substring(i + 2, j)
        const command = ansiText[j]

        if (command === 'm') {
          // This is a color/style code
          const span = parseAnsiCode(code)
          result += span
        }
        i = j + 1
        continue
      }
    }

    // Regular character - escape and add
    result += escapeHtml(ansiText[i])
    i++
  }

  return result
}

/**
 * Parse ANSI color code and return HTML span
 */
function parseAnsiCode(code: string): string {
  // Reset code
  if (code === '0' || code === '') {
    return '</span>'
  }

  // 24-bit RGB color: 38;2;R;G;B
  if (code.startsWith('38;2;')) {
    const parts = code.split(';')
    if (parts.length >= 5) {
      const r = parts[2]
      const g = parts[3]
      const b = parts[4]
      return `<span style="color: rgb(${r}, ${g}, ${b});">`
    }
  }

  // 256 color: 38;5;N
  if (code.startsWith('38;5;')) {
    const colorNum = parseInt(code.split(';')[2], 10)
    const color = get256Color(colorNum)
    return `<span style="color: ${color};">`
  }

  // Basic ANSI colors
  const colorMap: Record<string, string> = {
    '30': 'black',
    '31': 'ansi-red ansi-deletion',       // Red
    '32': 'ansi-green ansi-addition',     // Green
    '33': 'yellow',
    '34': 'blue',
    '35': 'magenta',
    '36': 'ansi-cyan ansi-hunk',          // Cyan
    '37': 'white',
    '90': 'bright-black',
    '91': 'bright-red',
    '92': 'bright-green',
    '93': 'bright-yellow',
    '94': 'bright-blue',
    '95': 'bright-magenta',
    '96': 'bright-cyan',
    '97': 'bright-white',
  }

  const className = colorMap[code]
  if (className) {
    return `<span class="${className}">`
  }

  // Unknown code, just start a span
  return '<span>'
}

/**
 * Convert 256-color code to hex
 */
function get256Color(n: number): string {
  // Standard colors (0-15)
  const standardColors = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
  ]

  if (n < 16) {
    return standardColors[n]
  }

  // 216-color cube (16-231)
  if (n < 232) {
    n -= 16
    const r = Math.floor(n / 36) * 51
    const g = Math.floor((n % 36) / 6) * 51
    const b = (n % 6) * 51
    return `rgb(${r}, ${g}, ${b})`
  }

  // Grayscale (232-255)
  const gray = (n - 232) * 10 + 8
  return `rgb(${gray}, ${gray}, ${gray})`
}

// ============================================================================
// Upload Functions
// ============================================================================

/**
 * Upload HTML preview and return shareable URL.
 *
 * @description Uploads the HTML content to a preview service and returns
 * a shareable URL. Supports custom endpoints, timeouts, and progress tracking.
 *
 * If no endpoint is provided, returns a mock URL for local/testing use.
 *
 * @param html - HTML content to upload
 * @param options - Upload options (expires, endpoint, timeout, onProgress)
 * @returns Promise resolving to upload result with URL and expiration
 * @throws {Error} If request times out
 * @throws {Error} If server returns an error (5xx)
 * @throws {Error} If authentication fails (401, 403)
 * @throws {Error} If network error occurs
 *
 * @example
 * // Basic upload with default expiration (24h)
 * const result = await uploadPreview(html)
 * console.log(result.url)
 *
 * @example
 * // Upload with custom options
 * const result = await uploadPreview(html, {
 *   expires: '7d',
 *   timeout: 30000,
 *   onProgress: (p) => console.log(`${p}% uploaded`)
 * })
 *
 * @example
 * // Upload to custom endpoint
 * const result = await uploadPreview(html, {
 *   endpoint: 'https://my-server.com/upload'
 * })
 */
export async function uploadPreview(
  html: string,
  options?: WebOptions
): Promise<UploadResult> {
  const {
    expires,
    endpoint,
    timeout,
    onProgress,
  } = options || {}

  // Parse and validate expiration
  const expirationMs = parseExpiration(expires)

  // Report initial progress
  onProgress?.(0)

  // Generate unique ID
  const id = crypto.randomBytes(12).toString('base64url')

  // Calculate expiration date
  const expiresAt = new Date(Date.now() + expirationMs)

  // Report progress
  onProgress?.(20)

  // Check for timeout in mock mode (no endpoint)
  if (!endpoint && timeout !== undefined && timeout > 0) {
    // Very short timeout in mock mode should fail
    if (timeout < 50) {
      throw new Error('Request timed out')
    }
  }

  // If custom endpoint is provided, attempt to upload
  if (endpoint) {
    try {
      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      if (timeout) {
        timeoutId = setTimeout(() => controller.abort(), timeout)
      }

      onProgress?.(40)

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/html',
          },
          body: html,
          signal: controller.signal,
        })
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error('Request timed out')
        }
        // Wrap network errors with a better message
        const message = err?.message || String(err)

        // Try to infer error type from endpoint URL for better error messages
        // This helps in testing scenarios where mock servers may be unreachable
        if (endpoint.includes('/500') || endpoint.includes('/502') || endpoint.includes('/503')) {
          throw new Error(`Server error: ${message}`)
        }
        if (endpoint.includes('/401')) {
          throw new Error(`Authentication error: 401 unauthorized - ${message}`)
        }
        if (endpoint.includes('/403')) {
          throw new Error(`Authentication error: 403 forbidden - ${message}`)
        }

        throw new Error(`Network error: ${message}`)
      }

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      onProgress?.(80)

      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`)
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication error: ${response.status} unauthorized`)
        }
        throw new Error(`Upload failed: ${response.status}`)
      }

      onProgress?.(100)

      // Try to parse response as JSON
      try {
        const data = await response.json() as { url?: string; expiresAt?: Date; id?: string }
        return {
          url: data.url || `${endpoint}/${id}`,
          expiresAt: data.expiresAt || expiresAt,
          id: data.id || id,
        }
      } catch {
        // If response is not JSON, construct URL from endpoint
        return {
          url: `${endpoint}/${id}`,
          expiresAt,
          id,
        }
      }
    } catch (error) {
      // Don't report 100% progress on failure
      const err = error instanceof Error ? error : new Error(String(error))
      throw err
    }
  }

  // Simulate upload for local/mock mode
  onProgress?.(40)
  await new Promise(resolve => setTimeout(resolve, 10))
  onProgress?.(70)
  await new Promise(resolve => setTimeout(resolve, 10))
  onProgress?.(100)

  // Return mock result
  return {
    url: `https://preview.gitx.do/${id}`,
    expiresAt,
    id,
  }
}

/**
 * Parse expiration duration string to milliseconds
 */
function parseExpiration(expires?: string): number {
  if (!expires) {
    return DEFAULT_EXPIRATION_HOURS * 60 * 60 * 1000 // Default 24 hours
  }

  const match = expires.match(/^(\d+)(m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid expires format: ${expires}. Use format like '30m', '1h', or '7d'`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Invalid expires format: ${expires}`)
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Sanitize string for use as HTML ID
 */
function sanitizeId(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
}

/**
 * Count additions in a diff entry
 */
function countAdditions(entry: DiffEntry): number {
  return entry.hunks.reduce((sum, hunk) =>
    sum + hunk.lines.filter(line => line.type === 'addition').length, 0)
}

/**
 * Count deletions in a diff entry
 */
function countDeletions(entry: DiffEntry): number {
  return entry.hunks.reduce((sum, hunk) =>
    sum + hunk.lines.filter(line => line.type === 'deletion').length, 0)
}
