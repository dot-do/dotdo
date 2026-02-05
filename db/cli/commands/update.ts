/**
 * Update Command - Update existing entity
 */

import type { ParsedArgs } from '../types'
import { print, printError, printJson, printSuccess } from '../types'
import { getContext } from '../db-context'

/**
 * Update an existing entity
 *
 * Usage:
 *   db update Organization acme.com '{"type": "customer"}'
 *   db update Contact 01HXYZ123 --set 'status=active'
 */
export async function updateCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  const entityId = args.args[1]
  const dataArg = args.args[2]

  if (!typeName) {
    printError('Type name required')
    print('Usage: db update <Type> <id> <json-data>')
    return 1
  }

  if (!entityId) {
    printError('Entity ID required')
    print('Usage: db update <Type> <id> <json-data>')
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
    // Parse update data
    let updates: Record<string, unknown> = {}

    // From JSON argument
    if (dataArg) {
      try {
        updates = JSON.parse(dataArg)
      } catch {
        printError('Invalid JSON data')
        print('Example: db update User user-123 \'{"status": "active"}\'')
        return 1
      }
    }

    // From --set option (key=value pairs)
    if (args.options.set) {
      const setStr = String(args.options.set)
      const parts = setStr.split(',')
      for (const part of parts) {
        const [key, value] = part.split('=')
        if (key && value !== undefined) {
          // Try to parse as JSON for numbers/booleans
          try {
            updates[key.trim()] = JSON.parse(value.trim())
          } catch {
            updates[key.trim()] = value.trim()
          }
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      printError('No updates provided')
      print('Provide JSON data or use --set key=value')
      return 1
    }

    // Placeholder for actual implementation
    // In real implementation, this would:
    // 1. Load existing entity
    // 2. Merge updates
    // 3. Update $updatedAt
    // 4. Write back to parquet

    // Simulate finding entity
    const existing: Record<string, unknown> | null = null

    if (!existing) {
      printError(`${typeName} with ID "${entityId}" not found`)
      return 1
    }

    const updated = {
      ...existing,
      ...updates,
      $updatedAt: new Date().toISOString()
    }

    printSuccess(`Updated ${typeName} ${entityId}`)

    // Output updated entity
    if (!args.options.quiet) {
      const pretty = args.options.pretty !== false
      printJson(updated, pretty)
    }

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to update entity: ${message}`)
    return 1
  }
}
