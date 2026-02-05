/**
 * Export Command - Export data to files
 */

import { writeFileSync } from 'fs'
import type { ParsedArgs } from '../types'
import { print, printError, printSuccess, spinner, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Export data to JSON, NDJSON, CSV, or Parquet files
 *
 * Usage:
 *   db export Organization data.json
 *   db export Industry --format csv > industries.csv
 *   db export Contact contacts.ndjson --format ndjson
 */
export async function exportCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  const filePath = args.args[1]

  if (!typeName) {
    printError('Type name required')
    print('Usage: db export <Type> [file]')
    return 1
  }

  // Validate type exists
  if (!(await ctx.hasType(typeName))) {
    printError(`Unknown type: ${typeName}`)
    const types = await ctx.getTypes()
    print(`Available types: ${types.join(', ')}`)
    return 1
  }

  try {
    // Detect format from extension or option
    let format = String(args.options.format ?? '')
    if (!format && filePath) {
      if (filePath.endsWith('.json')) format = 'json'
      else if (filePath.endsWith('.ndjson') || filePath.endsWith('.jsonl'))
        format = 'ndjson'
      else if (filePath.endsWith('.csv')) format = 'csv'
      else if (filePath.endsWith('.tsv')) format = 'tsv'
      else if (filePath.endsWith('.parquet')) format = 'parquet'
    }
    format = format || 'json'

    const s = spinner(`Exporting ${typeName}...`)

    // Placeholder for actual implementation
    // In real implementation, this would:
    // 1. Query all entities of this type
    // 2. Apply any filters
    // 3. Format output

    const records: Record<string, unknown>[] = []

    s.stop()

    if (records.length === 0) {
      print(colorize('No records to export', 'dim'))
      return 0
    }

    // Format output
    let output: string

    switch (format) {
      case 'json':
        output = JSON.stringify(
          records,
          null,
          args.options.pretty !== false ? 2 : 0
        )
        break
      case 'ndjson':
        output = records.map((r) => JSON.stringify(r)).join('\n')
        break
      case 'csv':
        output = toCSV(records, ',')
        break
      case 'tsv':
        output = toCSV(records, '\t')
        break
      case 'parquet':
        printError('Parquet export not yet implemented')
        return 1
      default:
        printError(`Unknown format: ${format}`)
        return 1
    }

    // Write to file or stdout
    if (filePath) {
      writeFileSync(filePath, output)
      printSuccess(`Exported ${records.length} ${typeName} to ${filePath}`)
    } else {
      // Write to stdout
      console.log(output)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Export failed: ${message}`)
    return 1
  }
}

/**
 * Convert records to CSV/TSV
 */
function toCSV(records: Record<string, unknown>[], delimiter: string): string {
  if (records.length === 0) return ''

  // Get all unique keys across all records
  const keys = new Set<string>()
  for (const record of records) {
    for (const key of Object.keys(record)) {
      keys.add(key)
    }
  }
  const headers = Array.from(keys)

  // Build CSV
  const lines: string[] = []

  // Header row
  lines.push(headers.map((h) => escapeCSV(h, delimiter)).join(delimiter))

  // Data rows
  for (const record of records) {
    const values = headers.map((h) => {
      const value = record[h]
      if (value === null || value === undefined) return ''
      if (typeof value === 'object') return escapeCSV(JSON.stringify(value), delimiter)
      return escapeCSV(String(value), delimiter)
    })
    lines.push(values.join(delimiter))
  }

  return lines.join('\n')
}

/**
 * Escape a value for CSV/TSV
 */
function escapeCSV(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
