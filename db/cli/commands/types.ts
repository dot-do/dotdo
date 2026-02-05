/**
 * Types Command - List entity types
 */

import type { ParsedArgs } from '../types'
import { print, printError, printJson, colorize, printTable } from '../types'
import { getContext } from '../db-context'

/**
 * List all entity types in the schema
 */
export async function typesCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  try {
    const schemaInfo = await ctx.loadSchema()
    const types = schemaInfo.types

    if (types.length === 0) {
      print('No types defined in schema')
      print('Edit .db/index.ts to add entity types')
      return 0
    }

    // JSON output
    if (args.options.json) {
      printJson(types)
      return 0
    }

    // Table output with metadata
    if (args.options.table) {
      const rows = types.map((type) => ({
        Type: type,
        Path: ctx.getTypeDataPath(type)
      }))
      printTable(rows)
      return 0
    }

    // Simple list output (default)
    print(colorize(`Entity Types (${types.length}):`, 'bold'))
    print('')

    for (const type of types) {
      print(`  ${type}`)
    }

    print('')
    print(colorize('Use `db query <Type>` to query entities', 'dim'))

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to list types: ${message}`)
    return 1
  }
}
