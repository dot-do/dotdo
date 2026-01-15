/**
 * Output Display Component
 *
 * Renders REPL output with syntax highlighting and formatting.
 * Supports different output types: result, error, info, etc.
 */

import React from 'react'
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
}

/**
 * Format a value for display
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

/**
 * Get color for output type
 */
function getTypeColor(type: OutputType): string {
  switch (type) {
    case 'input':
      return 'gray'
    case 'result':
      return 'green'
    case 'error':
      return 'red'
    case 'warning':
      return 'yellow'
    case 'info':
      return 'cyan'
    case 'system':
      return 'magenta'
    default:
      return 'white'
  }
}

/**
 * Get prefix for output type
 */
function getTypePrefix(type: OutputType): string {
  switch (type) {
    case 'input':
      return '>'
    case 'result':
      return '<'
    case 'error':
      return '!'
    case 'warning':
      return '~'
    case 'info':
      return 'i'
    case 'system':
      return '*'
    default:
      return ' '
  }
}

/**
 * Single output entry component
 */
function OutputEntryView({ entry }: { entry: OutputEntry }): React.ReactElement {
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
}

/**
 * Output display component
 */
export function Output({ entries, maxEntries = 100 }: OutputProps): React.ReactElement {
  // Limit entries to maxEntries
  const visibleEntries = entries.slice(-maxEntries)

  return (
    <Box flexDirection="column">
      {visibleEntries.map((entry) => (
        <OutputEntryView key={entry.id} entry={entry} />
      ))}
    </Box>
  )
}

/**
 * Create an output entry helper
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
 * Error output component with stack trace
 */
export interface ErrorOutputProps {
  error: Error
  showStack?: boolean
}

export function ErrorOutput({ error, showStack = false }: ErrorOutputProps): React.ReactElement {
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
}

/**
 * Table output component for structured data
 */
export interface TableOutputProps {
  data: Record<string, unknown>[]
  columns?: string[]
}

export function TableOutput({ data, columns }: TableOutputProps): React.ReactElement {
  if (data.length === 0) {
    return <Text dimColor>(empty)</Text>
  }

  // Determine columns
  const cols = columns ?? Object.keys(data[0])

  // Calculate column widths
  const widths = cols.map(col => {
    const values = data.map(row => String(row[col] ?? '').length)
    return Math.max(col.length, ...values)
  })

  // Header
  const header = cols.map((col, i) => col.padEnd(widths[i])).join(' | ')
  const separator = widths.map(w => '-'.repeat(w)).join('-+-')

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
}
