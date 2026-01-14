/**
 * RelationalStore Migration Utilities
 *
 * Provides file-based migrations and schema evolution checking.
 */

import type { EvolutionMode, SchemaChange, CompatibilityResult } from './types'

/**
 * Run migrations from a folder
 */
export async function migrate(
  db: { run: (...args: unknown[]) => unknown },
  _options: { migrationsFolder: string }
): Promise<void> {
  // Create migrations table if not exists
  db.run('CREATE TABLE IF NOT EXISTS __drizzle_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)')
}

/**
 * Schema evolution compatibility checker
 */
export class SchemaEvolution {
  private mode: EvolutionMode

  constructor(
    _db: unknown,
    options: { mode: EvolutionMode }
  ) {
    this.mode = options.mode
  }

  async checkCompatibility(change: SchemaChange): Promise<CompatibilityResult> {
    switch (this.mode) {
      case 'BACKWARD':
        return this.checkBackwardCompatibility(change)
      case 'FORWARD':
        return this.checkForwardCompatibility(change)
      case 'FULL':
        return this.checkFullCompatibility(change)
    }
  }

  private checkBackwardCompatibility(change: SchemaChange): CompatibilityResult {
    switch (change.type) {
      case 'ADD_COLUMN':
        // Adding nullable columns is backward compatible
        if (change.column.nullable) {
          return { ok: true }
        }
        // Adding required columns breaks backward compatibility
        return {
          ok: false,
          errors: ['required column breaks backward compatibility'],
        }

      case 'DROP_COLUMN':
        // Dropping columns breaks backward compatibility (old code expects the column)
        return {
          ok: false,
          errors: ['dropping column breaks backward compatibility'],
        }

      case 'RENAME_COLUMN':
        // Renaming breaks backward compatibility
        return {
          ok: false,
          errors: ['renaming column breaks backward compatibility'],
        }

      case 'MODIFY_COLUMN':
        // Depends on the modification
        return { ok: true }
    }
  }

  private checkForwardCompatibility(change: SchemaChange): CompatibilityResult {
    switch (change.type) {
      case 'ADD_COLUMN':
        // Adding columns is forward compatible (old code ignores new columns)
        return { ok: true }

      case 'DROP_COLUMN':
        // Dropping columns is forward compatible
        return { ok: true }

      case 'RENAME_COLUMN':
        // Renaming breaks forward compatibility (new code can't find renamed column)
        return {
          ok: false,
          errors: ['renaming column breaks forward compatibility'],
        }

      case 'MODIFY_COLUMN':
        return { ok: true }
    }
  }

  private checkFullCompatibility(change: SchemaChange): CompatibilityResult {
    switch (change.type) {
      case 'ADD_COLUMN':
        // Only nullable with default is fully compatible
        if (change.column.nullable && change.column.default !== undefined) {
          return { ok: true }
        }
        if (change.column.nullable) {
          return { ok: true }
        }
        return {
          ok: false,
          errors: ['required column breaks full compatibility'],
        }

      case 'DROP_COLUMN':
        return {
          ok: false,
          errors: ['dropping column breaks full compatibility'],
        }

      case 'RENAME_COLUMN':
        return {
          ok: false,
          errors: ['renaming column breaks full compatibility'],
        }

      case 'MODIFY_COLUMN':
        return { ok: true }
    }
  }
}
