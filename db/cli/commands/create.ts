/**
 * Create Command - Create new entity
 */

import type { ParsedArgs } from '../types'
import { print, printError, printJson, printSuccess, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Create a new entity
 *
 * Usage:
 *   db create Organization '{"name": "Acme Corp", "domain": "acme.com"}'
 *   cat data.json | db create Organization
 */
export async function createCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  if (!typeName) {
    printError('Type name required')
    print('Usage: db create <Type> <json-data>')
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
    // Parse input data
    let data: Record<string, unknown>

    // From argument
    const dataArg = args.args[1]
    if (dataArg) {
      try {
        data = JSON.parse(dataArg)
      } catch {
        printError('Invalid JSON data')
        print('Example: db create User \'{"name": "Alice", "email": "alice@example.com"}\'')
        return 1
      }
    }
    // From stdin
    else {
      const stdin = await readStdin()
      if (!stdin) {
        printError('No data provided')
        print('Provide JSON data as argument or pipe from stdin')
        return 1
      }
      try {
        data = JSON.parse(stdin)
      } catch {
        printError('Invalid JSON from stdin')
        return 1
      }
    }

    // Validate required fields
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      printError('Data must be a JSON object')
      return 1
    }

    // Placeholder for actual implementation
    // In real implementation, this would:
    // 1. Validate data against schema
    // 2. Generate $id if not provided
    // 3. Add audit fields ($createdAt, $updatedAt)
    // 4. Write to parquet file

    const entity = {
      $id: data.$id ?? generateId(),
      $type: typeName,
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      ...data
    }

    printSuccess(`Created ${typeName}`)

    // Output created entity
    const pretty = args.options.pretty !== false
    if (!args.options.quiet) {
      printJson(entity, pretty)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to create entity: ${message}`)
    return 1
  }
}

/**
 * Read from stdin
 */
async function readStdin(): Promise<string> {
  // Check if stdin has data
  if (process.stdin.isTTY) {
    return ''
  }

  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data.trim())
    })
    // Timeout for non-interactive usage
    setTimeout(() => resolve(data.trim()), 100)
  })
}

/**
 * Generate a simple ID (ULID-like)
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${timestamp}${random}`
}
