/**
 * Init Command - Initialize a .db directory
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ParsedArgs } from '../types'
import { print, printSuccess, printError, printWarning } from '../types'

/**
 * Schema template for new databases
 */
const SCHEMA_TEMPLATE = `/**
 * Database Schema
 *
 * Define your entity types here using IceType notation.
 *
 * @example
 * \`\`\`typescript
 * import { DB } from 'parquedb'
 *
 * export default DB({
 *   User: {
 *     email: 'string!##',    // required, unique, indexed
 *     name: 'string',
 *     posts: '<- Post.author[]'
 *   },
 *   Post: {
 *     title: 'string!',
 *     content: 'text',
 *     author: '-> User.posts'
 *   }
 * })
 * \`\`\`
 *
 * @see https://db.headless.ly/docs/schema
 */

import { DB } from 'parquedb'

export const Schema = {
  // Define your entity types here
  // Example:
  //
  // User: {
  //   $id: 'slug',
  //   $name: 'name',
  //   name: 'string!',
  //   email: 'string!##',
  //   role: 'enum(admin,user) = "user"',
  // },
}

export default DB(Schema)
`

/**
 * Initialize a new .db directory
 */
export async function initCommand(args: ParsedArgs): Promise<number> {
  const directory = args.args[0] ?? process.cwd()
  const dbPath = join(directory, '.db')
  const schemaPath = join(dbPath, 'schema')

  // Check if already initialized
  if (existsSync(dbPath)) {
    if (args.options.force) {
      printWarning('Reinitializing existing .db directory')
    } else {
      printError(`Database already initialized at ${dbPath}`)
      print('Use --force to reinitialize')
      return 1
    }
  }

  try {
    // Create directories
    mkdirSync(dbPath, { recursive: true })
    mkdirSync(schemaPath, { recursive: true })

    // Create index.ts
    const indexPath = join(dbPath, 'index.ts')
    if (!existsSync(indexPath) || args.options.force) {
      writeFileSync(indexPath, SCHEMA_TEMPLATE)
    }

    // Create .gitignore for parquet files (optional, keep schema)
    const gitignorePath = join(dbPath, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(
        gitignorePath,
        `# ParqueDB data files
*.parquet
*.parquet.tmp

# Keep schema files
!schema/
!index.ts
`
      )
    }

    printSuccess(`Initialized database at ${dbPath}`)
    print('')
    print('Next steps:')
    print('  1. Edit .db/index.ts to define your schema')
    print('  2. Run `db types` to list available types')
    print('  3. Run `db create <Type> <data>` to add data')
    print('')
    print('For more info: https://db.headless.ly/docs')

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to initialize: ${message}`)
    return 1
  }
}
