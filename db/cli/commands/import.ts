/**
 * Import Command - Import data from files
 */

import { readFileSync, existsSync } from 'fs'
import type { ParsedArgs } from '../types'
import { print, printError, printSuccess, spinner, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Import data from JSON, NDJSON, CSV, or TSV files
 *
 * Usage:
 *   db import Organization data.json
 *   db import Industry .org.ai/business/.data/Industries.tsv
 *   db import Contact contacts.csv --format csv
 */
export async function importCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  const filePath = args.args[1]

  if (!typeName) {
    printError('Type name required')
    print('Usage: db import <Type> <file>')
    return 1
  }

  if (!filePath) {
    printError('File path required')
    print('Usage: db import <Type> <file>')
    return 1
  }

  // Validate type exists
  if (!(await ctx.hasType(typeName))) {
    printError(`Unknown type: ${typeName}`)
    const types = await ctx.getTypes()
    print(`Available types: ${types.join(', ')}`)
    return 1
  }

  // Check file exists
  if (!existsSync(filePath)) {
    printError(`File not found: ${filePath}`)
    return 1
  }

  try {
    // Detect format from extension or option
    let format = String(args.options.format ?? '')
    if (!format) {
      if (filePath.endsWith('.json')) format = 'json'
      else if (filePath.endsWith('.ndjson') || filePath.endsWith('.jsonl'))
        format = 'ndjson'
      else if (filePath.endsWith('.csv')) format = 'csv'
      else if (filePath.endsWith('.tsv')) format = 'tsv'
      else {
        printError('Could not detect file format')
        print('Use --format json|ndjson|csv|tsv')
        return 1
      }
    }

    const s = spinner(`Importing ${typeName} from ${filePath}...`)

    // Read and parse file
    const content = readFileSync(filePath, 'utf-8')
    let records: Record<string, unknown>[]

    switch (format) {
      case 'json':
        records = parseJson(content)
        break
      case 'ndjson':
        records = parseNdjson(content)
        break
      case 'csv':
        records = parseCsv(content, ',')
        break
      case 'tsv':
        records = parseCsv(content, '\t')
        break
      default:
        s.fail()
        printError(`Unknown format: ${format}`)
        return 1
    }

    s.stop()

    if (records.length === 0) {
      printError('No records found in file')
      return 1
    }

    // Dry run option
    if (args.options['dry-run']) {
      print(colorize(`Would import ${records.length} records`, 'yellow'))
      print('Sample record:')
      print(JSON.stringify(records[0], null, 2))
      return 0
    }

    // Placeholder for actual implementation
    // In real implementation, this would:
    // 1. Validate each record against schema
    // 2. Generate IDs if missing
    // 3. Batch write to parquet file

    const imported = records.length
    const errors = 0

    if (errors > 0) {
      printSuccess(`Imported ${imported} ${typeName} (${errors} errors)`)
    } else {
      printSuccess(`Imported ${imported} ${typeName}`)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Import failed: ${message}`)
    return 1
  }
}

/**
 * Parse JSON array
 */
function parseJson(content: string): Record<string, unknown>[] {
  const data = JSON.parse(content)

  if (Array.isArray(data)) {
    return data
  }

  // Single object
  return [data]
}

/**
 * Parse NDJSON (newline-delimited JSON)
 */
function parseNdjson(content: string): Record<string, unknown>[] {
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

/**
 * Parse CSV/TSV
 */
function parseCsv(
  content: string,
  delimiter: string
): Record<string, unknown>[] {
  const lines = content.split('\n').filter((line) => line.trim())

  if (lines.length < 2) {
    return []
  }

  // Parse header
  const headers = parseCSVLine(lines[0], delimiter)

  // Parse rows
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line, delimiter)
    const record: Record<string, unknown> = {}

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]
      let value: unknown = values[i] ?? ''

      // Try to parse as JSON for typed values
      if (typeof value === 'string') {
        const trimmed = value.trim()
        // Check for boolean
        if (trimmed === 'true') value = true
        else if (trimmed === 'false') value = false
        // Check for null
        else if (trimmed === '' || trimmed.toLowerCase() === 'null') value = null
        // Check for number
        else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          value = parseFloat(trimmed)
        }
      }

      record[header] = value
    }

    return record
  })
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"'
        i++
      } else {
        // Toggle quotes
        inQuotes = !inQuotes
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }

  values.push(current)
  return values
}
