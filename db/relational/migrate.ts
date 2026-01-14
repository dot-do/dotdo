/**
 * RelationalStore Migration Utilities
 *
 * This is a stub file. The implementation is TBD.
 *
 * @see README.md for API documentation
 */

/**
 * Run migrations from a folder
 */
export async function migrate(
  _db: unknown,
  _options: { migrationsFolder: string }
): Promise<void> {
  throw new Error('migrate is not yet implemented')
}

/**
 * Schema evolution compatibility checker
 */
export class SchemaEvolution {
  constructor(
    _db: unknown,
    _options: { mode: 'BACKWARD' | 'FORWARD' | 'FULL' }
  ) {
    throw new Error('SchemaEvolution is not yet implemented')
  }

  async checkCompatibility(
    _change: SchemaChange
  ): Promise<{ ok: boolean; errors?: string[] }> {
    throw new Error('SchemaEvolution is not yet implemented')
  }
}

type SchemaChange =
  | {
      type: 'ADD_COLUMN'
      table: string
      column: { name: string; type: string; nullable: boolean; default?: unknown }
    }
  | {
      type: 'DROP_COLUMN'
      table: string
      column: string
    }
  | {
      type: 'RENAME_COLUMN'
      table: string
      from: string
      to: string
    }
  | {
      type: 'MODIFY_COLUMN'
      table: string
      column: string
      changes: Partial<{ type: string; nullable: boolean; default: unknown }>
    }
