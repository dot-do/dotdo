/**
 * Query Command - Query entities with filtering
 */

import type { ParsedArgs } from '../types'
import {
  print,
  printError,
  printJson,
  printTable,
  colorize,
  spinner
} from '../types'
import { getContext } from '../db-context'

/**
 * Query entities with MongoDB-style filtering
 *
 * Usage:
 *   db query Organization
 *   db query Organization '{"type": "customer"}'
 *   db query Contact --limit 10
 *   db query Deal --where 'stage=negotiation'
 */
export async function queryCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  if (!typeName) {
    printError('Type name required')
    print('Usage: db query <Type> [filter]')
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
    // Parse filter if provided
    let filter: Record<string, unknown> = {}
    const filterArg = args.args[1]

    if (filterArg) {
      try {
        filter = JSON.parse(filterArg)
      } catch {
        printError('Invalid filter JSON')
        print('Example: db query User \'{"status": "active"}\'')
        return 1
      }
    }

    // Parse --where option as simple key=value filters
    if (args.options.where) {
      const whereStr = String(args.options.where)
      const parts = whereStr.split(',')
      for (const part of parts) {
        const [key, value] = part.split('=')
        if (key && value) {
          filter[key.trim()] = value.trim()
        }
      }
    }

    // Options
    const limit = parseInt(String(args.options.limit ?? '100'), 10)
    const offset = parseInt(String(args.options.offset ?? '0'), 10)
    const pretty = args.options.pretty !== false
    const format = String(args.options.format ?? 'json')

    // Show query info
    if (!args.options.quiet) {
      const filterStr =
        Object.keys(filter).length > 0
          ? ` with filter: ${JSON.stringify(filter)}`
          : ''
      print(colorize(`Querying ${typeName}${filterStr}`, 'dim'))
    }

    // Execute query
    // Note: This is a placeholder - actual implementation would use ParqueDB
    const s = spinner('Fetching...')

    // Simulated query - in real implementation, this would:
    // 1. Load the parquet file for this type
    // 2. Apply filter predicates
    // 3. Return matching entities
    const results: Record<string, unknown>[] = []

    // For now, return empty results with message
    s.stop()

    if (results.length === 0) {
      print(colorize('No results found', 'dim'))
      print('')
      print('To add data:')
      print(`  db create ${typeName} '{"name": "Example"}'`)
      print(`  db import ${typeName} data.json`)
      return 0
    }

    // Format output
    switch (format) {
      case 'json':
        printJson(results, pretty)
        break
      case 'table':
        printTable(results)
        break
      case 'ndjson':
        for (const row of results) {
          print(JSON.stringify(row))
        }
        break
      case 'csv':
        printCsv(results)
        break
      default:
        printJson(results, pretty)
    }

    if (!args.options.quiet) {
      print('')
      print(colorize(`Found ${results.length} result(s)`, 'dim'))
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Query failed: ${message}`)
    return 1
  }
}

/**
 * Print results as CSV
 */
function printCsv(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return

  const columns = Object.keys(rows[0])

  // Header
  print(columns.map(escapeCSV).join(','))

  // Rows
  for (const row of rows) {
    const values = columns.map((col) => escapeCSV(String(row[col] ?? '')))
    print(values.join(','))
  }
}

/**
 * Escape a value for CSV
 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
