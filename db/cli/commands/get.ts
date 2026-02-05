/**
 * Get Command - Get single entity by ID
 */

import type { ParsedArgs } from '../types'
import { print, printError, printJson, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Get a single entity by its ID
 *
 * Usage:
 *   db get Organization acme.com
 *   db get Contact 01HXYZ123
 */
export async function getCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]
  const entityId = args.args[1]

  if (!typeName) {
    printError('Type name required')
    print('Usage: db get <Type> <id>')
    return 1
  }

  if (!entityId) {
    printError('Entity ID required')
    print('Usage: db get <Type> <id>')
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
    // Placeholder for actual implementation
    // In real implementation, this would:
    // 1. Load the parquet file for this type
    // 2. Find entity by $id field
    // 3. Return the entity

    const entity: Record<string, unknown> | null = null

    if (!entity) {
      printError(`${typeName} with ID "${entityId}" not found`)
      return 1
    }

    // Output
    const pretty = args.options.pretty !== false
    printJson(entity, pretty)

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to get entity: ${message}`)
    return 1
  }
}
