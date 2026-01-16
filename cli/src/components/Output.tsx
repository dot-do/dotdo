/**
 * Output Display Component
 *
 * Renders REPL output with syntax highlighting and formatting.
 * Supports different output types: result, error, info, etc.
 *
 * Optimizations:
 * - React.memo for entry components to prevent unnecessary re-renders
 * - useMemo for computed values (visible entries, formatted content)
 * - useCallback for stable callback references
 * - Virtual windowing for large output lists
 * - Debounced state updates for rapid log messages
 * - Memory-efficient log buffer with configurable max size
 */

import React, { memo, useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { Box, Text } from 'ink'

/**
 * Output entry types
 */
export type OutputType = 'input' | 'result' | 'error' | 'info' | 'warning' | 'system'

export interface OutputEntry {
  id: string
  type: OutputType
  content: string
  timestamp: Date
}

export interface OutputProps {
  entries: OutputEntry[]
  maxEntries?: number
  /** Enable virtual scrolling for performance with large lists */
  virtualScroll?: boolean
  /** Number of entries to render in viewport when virtualScroll is enabled */
  viewportSize?: number
}

/**
 * Format a value for display (memoization-friendly pure function)
 */
function formatValue(value: unknown, depth = 0): string {
  const indent = '  '.repeat(depth)

  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'bigint') return `${value}n`

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    return `Error: ${value.message}`
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (depth > 3) return '[...]'

    const items = value.map(v => formatValue(v, depth + 1))
    if (items.join(', ').length < 60) {
      return `[${items.join(', ')}]`
    }
    return `[\n${indent}  ${items.join(`,\n${indent}  `)}\n${indent}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    if (depth > 3) return '{...}'

    const items = entries.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`)
    if (items.join(', ').length < 60) {
      return `{ ${items.join(', ')} }`
    }
    return `{\n${indent}  ${items.join(`,\n${indent}  `)}\n${indent}}`
  }

  return String(value)
}

// Pre-computed color and prefix maps for O(1) lookups
const TYPE_COLORS: Record<OutputType, string> = {
  input: 'gray',
  result: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  system: 'magenta',
}

const TYPE_PREFIXES: Record<OutputType, string> = {
  input: '>',
  result: '<',
  error: '!',
  warning: '~',
  info: 'i',
  system: '*',
}

/**
 * Get color for output type (O(1) lookup)
 */
function getTypeColor(type: OutputType): string {
  return TYPE_COLORS[type] ?? 'white'
}

/**
 * Get prefix for output type (O(1) lookup)
 */
function getTypePrefix(type: OutputType): string {
  return TYPE_PREFIXES[type] ?? ' '
}

/**
 * Single output entry component - memoized to prevent re-renders
 * Only re-renders when entry.id changes
 */
const OutputEntryView = memo(function OutputEntryView({ entry }: { entry: OutputEntry }): React.ReactElement {
  const color = getTypeColor(entry.type)
  const prefix = getTypePrefix(entry.type)

  return (
    <Box>
      <Text color={color}>
        <Text dimColor>{prefix} </Text>
        {entry.content}
      </Text>
    </Box>
  )
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if entry id changes
  return prevProps.entry.id === nextProps.entry.id
})

/**
 * Output display component with performance optimizations
 */
export const Output = memo(function Output({
  entries,
  maxEntries = 100,
  virtualScroll = false,
  viewportSize = 50,
}: OutputProps): React.ReactElement {
  // Memoize the visible entries computation
  const visibleEntries = useMemo(() => {
    // Apply max entries limit (sliding window from end)
    const limited = entries.slice(-maxEntries)

    // If virtual scrolling is disabled or list is small, return all
    if (!virtualScroll || limited.length <= viewportSize) {
      return limited
    }

    // Virtual scroll: only render the last viewportSize entries
    // This provides a "tail" view of the output
    return limited.slice(-viewportSize)
  }, [entries, maxEntries, virtualScroll, viewportSize])

  // Track if we're truncating output for virtual scroll indicator
  const isTruncated = useMemo(() => {
    if (!virtualScroll) return false
    const limited = entries.slice(-maxEntries)
    return limited.length > viewportSize
  }, [entries, maxEntries, virtualScroll, viewportSize])

  const truncatedCount = useMemo(() => {
    if (!isTruncated) return 0
    const limited = entries.slice(-maxEntries)
    return limited.length - viewportSize
  }, [entries, maxEntries, viewportSize, isTruncated])

  return (
    <Box flexDirection="column">
      {isTruncated && (
        <Box>
          <Text dimColor>... {truncatedCount} more entries above ...</Text>
        </Box>
      )}
      {visibleEntries.map((entry) => (
        <OutputEntryView key={entry.id} entry={entry} />
      ))}
    </Box>
  )
})

/**
 * Create an output entry helper
 * Uses monotonic counter + timestamp for unique IDs
 */
let entryCounter = 0

export function createOutputEntry(
  type: OutputType,
  content: unknown
): OutputEntry {
  return {
    id: `output_${++entryCounter}_${Date.now()}`,
    type,
    content: typeof content === 'string' ? content : formatValue(content),
    timestamp: new Date(),
  }
}

/**
 * Reset entry counter (for testing)
 */
export function resetEntryCounter(): void {
  entryCounter = 0
}

/**
 * Error output component with stack trace - memoized
 */
export interface ErrorOutputProps {
  error: Error
  showStack?: boolean
}

export const ErrorOutput = memo(function ErrorOutput({ error, showStack = false }: ErrorOutputProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="red">
        <Text bold>Error:</Text> {error.message}
      </Text>
      {showStack && error.stack && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>
            {error.stack.split('\n').slice(1).join('\n')}
          </Text>
        </Box>
      )}
    </Box>
  )
})

/**
 * Table output component for structured data - memoized
 */
export interface TableOutputProps {
  data: Record<string, unknown>[]
  columns?: string[]
}

export const TableOutput = memo(function TableOutput({ data, columns }: TableOutputProps): React.ReactElement {
  // Memoize column computation
  const cols = useMemo(() => {
    if (data.length === 0) return []
    return columns ?? Object.keys(data[0])
  }, [data, columns])

  // Memoize width computation
  const widths = useMemo(() => {
    return cols.map(col => {
      const values = data.map(row => String(row[col] ?? '').length)
      return Math.max(col.length, ...values)
    })
  }, [cols, data])

  // Memoize header and separator
  const { header, separator } = useMemo(() => {
    const h = cols.map((col, i) => col.padEnd(widths[i])).join(' | ')
    const s = widths.map(w => '-'.repeat(w)).join('-+-')
    return { header: h, separator: s }
  }, [cols, widths])

  if (data.length === 0) {
    return <Text dimColor>(empty)</Text>
  }

  return (
    <Box flexDirection="column">
      <Text bold>{header}</Text>
      <Text dimColor>{separator}</Text>
      {data.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {cols.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join(' | ')}
        </Text>
      ))}
    </Box>
  )
})

// =============================================================================
// Streaming Output Hooks and Utilities
// =============================================================================

/**
 * Configuration for useStreamingOutput hook
 */
export interface StreamingOutputConfig {
  /** Maximum number of entries to keep in memory */
  maxEntries?: number
  /** Debounce interval in ms for rapid updates (default: 16ms for 60fps) */
  debounceMs?: number
  /** Enable virtual scrolling for large lists */
  virtualScroll?: boolean
  /** Viewport size for virtual scrolling */
  viewportSize?: number
}

/**
 * Hook for managing streaming output with optimized rendering
 *
 * Features:
 * - Debounced updates for rapid log messages
 * - Automatic memory management with configurable max entries
 * - Stable callback references
 * - Efficient batch updates
 */
export function useStreamingOutput(config: StreamingOutputConfig = {}) {
  const {
    maxEntries = 1000,
    debounceMs = 16, // ~60fps
    virtualScroll = false,
    viewportSize = 50,
  } = config

  const [entries, setEntries] = useState<OutputEntry[]>([])
  const pendingEntriesRef = useRef<OutputEntry[]>([])
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
    }
  }, [])

  // Flush pending entries to state
  const flushPending = useCallback(() => {
    if (!isMountedRef.current) return

    if (pendingEntriesRef.current.length > 0) {
      const toFlush = pendingEntriesRef.current
      pendingEntriesRef.current = []

      setEntries(prev => {
        const combined = [...prev, ...toFlush]
        // Apply memory limit
        if (combined.length > maxEntries) {
          return combined.slice(-maxEntries)
        }
        return combined
      })
    }
    flushTimeoutRef.current = null
  }, [maxEntries])

  // Add a single entry with debouncing
  const addEntry = useCallback((type: OutputType, content: unknown) => {
    const entry = createOutputEntry(type, content)
    pendingEntriesRef.current.push(entry)

    // Schedule flush if not already scheduled
    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(flushPending, debounceMs)
    }
  }, [debounceMs, flushPending])

  // Add multiple entries at once (bypasses debouncing for immediate batch)
  const addEntries = useCallback((newEntries: Array<{ type: OutputType; content: unknown }>) => {
    const created = newEntries.map(({ type, content }) => createOutputEntry(type, content))

    setEntries(prev => {
      const combined = [...prev, ...created]
      if (combined.length > maxEntries) {
        return combined.slice(-maxEntries)
      }
      return combined
    })
  }, [maxEntries])

  // Clear all entries
  const clear = useCallback(() => {
    pendingEntriesRef.current = []
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    setEntries([])
  }, [])

  // Force flush (useful before unmount or when immediate rendering is needed)
  const flush = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
    }
    flushPending()
  }, [flushPending])

  // Output props ready to spread
  const outputProps = useMemo(() => ({
    entries,
    maxEntries,
    virtualScroll,
    viewportSize,
  }), [entries, maxEntries, virtualScroll, viewportSize])

  return {
    entries,
    addEntry,
    addEntries,
    clear,
    flush,
    outputProps,
  }
}

/**
 * Buffer for managing log entries with memory limits
 * Useful for non-React contexts or when you need direct buffer access
 */
export class OutputBuffer {
  private entries: OutputEntry[] = []
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  add(type: OutputType, content: unknown): OutputEntry {
    const entry = createOutputEntry(type, content)
    this.entries.push(entry)

    // Trim if over limit
    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize)
    }

    return entry
  }

  addBatch(items: Array<{ type: OutputType; content: unknown }>): OutputEntry[] {
    const newEntries = items.map(({ type, content }) => createOutputEntry(type, content))
    this.entries.push(...newEntries)

    if (this.entries.length > this.maxSize) {
      this.entries = this.entries.slice(-this.maxSize)
    }

    return newEntries
  }

  getEntries(): OutputEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  get length(): number {
    return this.entries.length
  }
}
