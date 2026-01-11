/**
 * CLI Output Formatting
 *
 * Provides utilities for formatting CLI output:
 * - JSON output for scripting
 * - Table output for lists
 * - Streaming output for LLM responses
 * - Spinner for long-running operations
 */

// ============================================================================
// Types
// ============================================================================

export interface OutputOptions {
  /** Pretty print JSON */
  pretty?: boolean
  /** Columns to display in table */
  columns?: string[]
  /** Maximum width for truncation */
  maxWidth?: number
}

export interface Spinner {
  /** Start the spinner animation */
  start(): void
  /** Stop the spinner */
  stop(): void
  /** Stop with success message */
  succeed(message?: string): void
  /** Stop with failure message */
  fail(message?: string): void
  /** Update spinner text */
  text(message: string): void
}

// ============================================================================
// JSON Formatting
// ============================================================================

/**
 * Format data as JSON string
 */
export function formatJson(data: unknown, options: OutputOptions = {}): string {
  if (options.pretty) {
    return JSON.stringify(data, null, 2)
  }
  return JSON.stringify(data)
}

// ============================================================================
// Table Formatting
// ============================================================================

/**
 * Format array of objects as ASCII table
 */
export function formatTable(
  data: Record<string, unknown>[],
  options: OutputOptions = {}
): string {
  if (data.length === 0) {
    return ''
  }

  // Determine columns
  const columns = options.columns ?? Object.keys(data[0])
  const maxWidth = options.maxWidth ?? 50

  // Calculate column widths
  const widths: Record<string, number> = {}
  for (const col of columns) {
    widths[col] = col.length
    for (const row of data) {
      const value = String(row[col] ?? '')
      widths[col] = Math.max(widths[col], Math.min(value.length, maxWidth))
    }
  }

  // Format header
  const header = columns.map((col) => col.padEnd(widths[col])).join('  ')
  const separator = columns.map((col) => '-'.repeat(widths[col])).join('  ')

  // Format rows
  const rows = data.map((row) => {
    return columns
      .map((col) => {
        const value = String(row[col] ?? '')
        const truncated = value.length > maxWidth ? value.slice(0, maxWidth - 3) + '...' : value
        return truncated.padEnd(widths[col])
      })
      .join('  ')
  })

  return [header, separator, ...rows].join('\n')
}

// ============================================================================
// Streaming Output
// ============================================================================

/**
 * Async iterator for streaming response
 */
export async function* formatStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield decoder.decode(value, { stream: true })
    }
  } finally {
    // releaseLock may not exist in all environments (e.g., mocks)
    if (typeof reader.releaseLock === 'function') {
      reader.releaseLock()
    }
  }
}

/**
 * Parse SSE stream and extract content
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  let buffer = ''

  for await (const chunk of formatStream(stream)) {
    buffer += chunk

    // Process complete lines
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          if (parsed.delta) {
            yield parsed.delta
          } else if (parsed.content) {
            yield parsed.content
          } else if (parsed.choices?.[0]?.delta?.content) {
            yield parsed.choices[0].delta.content
          }
        } catch {
          // Not JSON, might be raw content
          yield data
        }
      }
    }
  }

  // Process any remaining buffer
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6)
    if (data !== '[DONE]') {
      try {
        const parsed = JSON.parse(data)
        if (parsed.delta) {
          yield parsed.delta
        }
      } catch {
        yield data
      }
    }
  }
}

// ============================================================================
// Spinner
// ============================================================================

const SPINNER_FRAMES = ['|', '/', '-', '\\']

/**
 * Create a CLI spinner for long-running operations
 */
export function createSpinner(message: string): Spinner {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let frameIndex = 0
  let currentMessage = message

  const render = () => {
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]
    process.stdout.write(`\r${frame} ${currentMessage}`)
    frameIndex++
  }

  const clear = () => {
    process.stdout.write('\r' + ' '.repeat(currentMessage.length + 3) + '\r')
  }

  return {
    start() {
      if (intervalId) return
      render()
      intervalId = setInterval(render, 100)
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
      clear()
    },

    succeed(msg?: string) {
      this.stop()
      console.log(`\u2713 ${msg ?? currentMessage}`)
    },

    fail(msg?: string) {
      this.stop()
      console.log(`\u2717 ${msg ?? currentMessage}`)
    },

    text(msg: string) {
      currentMessage = msg
    },
  }
}

// ============================================================================
// Color Output (if terminal supports it)
// ============================================================================

const supportsColor = process.stdout.isTTY && process.env.TERM !== 'dumb'

export const colors = {
  red: (text: string) => (supportsColor ? `\x1b[31m${text}\x1b[0m` : text),
  green: (text: string) => (supportsColor ? `\x1b[32m${text}\x1b[0m` : text),
  yellow: (text: string) => (supportsColor ? `\x1b[33m${text}\x1b[0m` : text),
  blue: (text: string) => (supportsColor ? `\x1b[34m${text}\x1b[0m` : text),
  dim: (text: string) => (supportsColor ? `\x1b[2m${text}\x1b[0m` : text),
  bold: (text: string) => (supportsColor ? `\x1b[1m${text}\x1b[0m` : text),
}
