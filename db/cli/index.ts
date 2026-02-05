#!/usr/bin/env node
/**
 * @dotdo/db CLI
 *
 * Command-line interface for @dotdo/db database management.
 *
 * Commands:
 *   init              Initialize a .db directory with schema template
 *   schema            Show/validate schema from .db/index.ts
 *   types             List all entity types
 *   query <type>      Query entities with filtering (MongoDB-style)
 *   get <type> <id>   Get single entity by ID
 *   create <type>     Create entity (JSON from stdin or args)
 *   update <id>       Update entity
 *   delete <id>       Delete entity
 *   import <type>     Import from JSON/CSV/TSV
 *   export <type>     Export to JSON/CSV/Parquet
 *   push              Push to db.headless.ly
 *   pull              Pull from db.headless.ly
 *   sync              Bidirectional sync with CDC conflict resolution
 *   generate          Generate TypeScript types from schema
 *   stats             Show database statistics
 *   doctor            Validate schema and data integrity
 *
 * Usage:
 *   db init [directory]
 *   db query <type> [filter]
 *   db import <type> <file>
 *   db export <type> <file>
 */

import { registry } from './registry'
import { parseArgs, print, printError } from './types'
import { initCommand } from './commands/init'
import { schemaCommand } from './commands/schema'
import { typesCommand } from './commands/types'
import { queryCommand } from './commands/query'
import { getCommand } from './commands/get'
import { createCommand } from './commands/create'
import { updateCommand } from './commands/update'
import { deleteCommand } from './commands/delete'
import { importCommand } from './commands/import'
import { exportCommand } from './commands/export'
import { pushCommand, pullCommand, syncCommand } from './commands/sync'
import { generateCommand } from './commands/generate'
import { statsCommand } from './commands/stats'
import { doctorCommand } from './commands/doctor'

// =============================================================================
// Register Built-in Commands
// =============================================================================

registry.register({
  name: 'init',
  description: 'Initialize a .db directory',
  usage: 'db init [directory]',
  category: 'Database',
  execute: initCommand
})

registry.register({
  name: 'schema',
  description: 'Show/validate schema from .db/index.ts',
  usage: 'db schema [show|validate|diff]',
  category: 'Database',
  execute: schemaCommand
})

registry.register({
  name: 'types',
  description: 'List all entity types in schema',
  usage: 'db types [--json]',
  category: 'Database',
  aliases: ['ls'],
  execute: typesCommand
})

registry.register({
  name: 'query',
  description: 'Query entities with filtering',
  usage: 'db query <type> [filter] [--where key=value] [--limit n]',
  category: 'Data',
  aliases: ['find'],
  execute: queryCommand
})

registry.register({
  name: 'get',
  description: 'Get single entity by ID',
  usage: 'db get <type> <id>',
  category: 'Data',
  execute: getCommand
})

registry.register({
  name: 'create',
  description: 'Create a new entity',
  usage: 'db create <type> <json-data>',
  category: 'Data',
  aliases: ['add', 'insert'],
  execute: createCommand
})

registry.register({
  name: 'update',
  description: 'Update an existing entity',
  usage: 'db update <type> <id> <json-data>',
  category: 'Data',
  aliases: ['set'],
  execute: updateCommand
})

registry.register({
  name: 'delete',
  description: 'Delete an entity',
  usage: 'db delete <type> <id> [--force]',
  category: 'Data',
  aliases: ['rm', 'remove'],
  execute: deleteCommand
})

registry.register({
  name: 'import',
  description: 'Import data from JSON/NDJSON/CSV/TSV',
  usage: 'db import <type> <file> [--format json|ndjson|csv|tsv]',
  category: 'Data',
  execute: importCommand
})

registry.register({
  name: 'export',
  description: 'Export data to JSON/NDJSON/CSV/Parquet',
  usage: 'db export <type> [file] [--format json|ndjson|csv|parquet]',
  category: 'Data',
  execute: exportCommand
})

registry.register({
  name: 'push',
  description: 'Push local database to remote (db.headless.ly)',
  usage: 'db push [--visibility public|private]',
  category: 'Sync',
  execute: pushCommand
})

registry.register({
  name: 'pull',
  description: 'Pull remote database to local',
  usage: 'db pull [owner/database]',
  category: 'Sync',
  execute: pullCommand
})

registry.register({
  name: 'sync',
  description: 'Bidirectional sync with conflict resolution',
  usage: 'db sync [--strategy local-wins|remote-wins|newest]',
  category: 'Sync',
  execute: syncCommand
})

registry.register({
  name: 'generate',
  description: 'Generate TypeScript types from schema',
  usage: 'db generate [--output path]',
  category: 'Development',
  aliases: ['gen'],
  execute: generateCommand
})

registry.register({
  name: 'stats',
  description: 'Show database statistics',
  usage: 'db stats [type]',
  category: 'Database',
  execute: statsCommand
})

registry.register({
  name: 'doctor',
  description: 'Validate schema and data integrity',
  usage: 'db doctor [--fix]',
  category: 'Database',
  execute: doctorCommand
})

// =============================================================================
// Constants
// =============================================================================

const VERSION = '0.1.0'

const HELP_TEXT = `
@dotdo/db CLI v${VERSION}

A command-line interface for @dotdo/db database management.

USAGE:
  db <command> [options]

COMMANDS:
  Database:
    init [directory]              Initialize a .db directory
    schema [show|validate|diff]   Show/validate database schema
    types                         List all entity types
    stats [type]                  Show database statistics
    doctor [--fix]                Validate schema and data integrity

  Data:
    query <type> [filter]         Query entities (MongoDB-style filter)
    get <type> <id>               Get single entity by ID
    create <type> <data>          Create new entity
    update <type> <id> <data>     Update entity
    delete <type> <id>            Delete entity
    import <type> <file>          Import from JSON/CSV/TSV file
    export <type> [file]          Export to JSON/CSV/Parquet

  Sync:
    push                          Push to db.headless.ly
    pull [owner/database]         Pull from db.headless.ly
    sync                          Bidirectional sync with CDC

  Development:
    generate [--output path]      Generate TypeScript types

OPTIONS:
  -h, --help                      Show this help message
  -v, --version                   Show version number
  -d, --directory <path>          Database directory (default: .db)
  -f, --format <format>           Output format: json, table, csv
  -l, --limit <n>                 Limit number of results
  -p, --pretty                    Pretty print JSON output
  --json                          Output as JSON
  --quiet                         Suppress non-essential output

EXAMPLES:
  # Initialize a database
  db init

  # List entity types
  db types

  # Query all customers
  db query Organization '{"type": "customer"}'

  # Create a new contact
  db create Contact '{"name": "Alice", "email": "alice@example.com"}'

  # Import data from CSV
  db import Industry industries.csv

  # Export data to JSON
  db export Organization orgs.json

  # Generate TypeScript types
  db generate

  # Push to remote
  db push --visibility public

ENVIRONMENT:
  HEADLESSLY_DB_REMOTE    Remote database endpoint (e.g., db.headless.ly)
  HEADLESSLY_API_KEY      API key for remote operations

For more info: https://db.headless.ly/docs
`

// =============================================================================
// Re-exports
// =============================================================================

export { parseArgs, print, printError, printSuccess } from './types'
export type { ParsedArgs } from './types'
export { registry } from './registry'
export type { Command, CommandRegistry } from './registry'
export { getContext, resetContext } from './db-context'
export type { DBConfig, DBContext, SchemaInfo } from './db-context'

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main CLI entry point
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArgs(argv)

    // Handle help
    if (parsed.options.help) {
      print(HELP_TEXT)
      return 0
    }

    // Handle version
    if (parsed.options.version) {
      print(`db v${VERSION}`)
      return 0
    }

    // No command provided
    if (!parsed.command) {
      print(HELP_TEXT)
      return 0
    }

    // Handle 'help' as a special case
    if (parsed.command === 'help') {
      print(HELP_TEXT)
      return 0
    }

    // Look up command in registry
    const command = registry.get(parsed.command)
    if (!command) {
      printError(`Unknown command: ${parsed.command}`)
      print('\nRun "db --help" for usage.')
      return 1
    }

    // Execute the command
    return await command.execute(parsed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(message)
    return 1
  }
}

// Run CLI if this is the main module
if (
  process.argv[1]?.endsWith('/cli/index.js') ||
  process.argv[1]?.endsWith('/cli/index.ts') ||
  process.argv[1]?.endsWith('/db-cli.js')
) {
  main().then((code) => process.exit(code))
}
