/**
 * Database Context for @dotdo/db CLI
 *
 * Manages database instance lifecycle and configuration.
 */

import { resolve, join } from 'path'
import { existsSync, readFileSync } from 'fs'

// =============================================================================
// Types
// =============================================================================

/**
 * Database configuration
 */
export interface DBConfig {
  /** Path to .db directory */
  dbPath: string
  /** Path to schema file */
  schemaPath: string
  /** Remote endpoint for sync operations */
  remote?: string
  /** API key for remote operations */
  apiKey?: string
  /** Default output format */
  format?: 'json' | 'table' | 'csv'
}

/**
 * Loaded schema information
 */
export interface SchemaInfo {
  /** Entity type names */
  types: string[]
  /** Full schema definition */
  schema: Record<string, Record<string, string>>
  /** Schema source file path */
  sourcePath: string
}

// =============================================================================
// Context
// =============================================================================

/**
 * Database context for CLI operations
 *
 * Handles:
 * - Finding and loading .db directory
 * - Loading schema from index.ts
 * - Managing remote configuration
 */
export class DBContext {
  private config: DBConfig
  private schemaInfo: SchemaInfo | null = null

  constructor(config: Partial<DBConfig> = {}) {
    // Find .db directory
    const dbPath = config.dbPath ?? this.findDbDirectory()

    this.config = {
      dbPath,
      schemaPath: config.schemaPath ?? join(dbPath, 'index.ts'),
      remote: config.remote ?? process.env.HEADLESSLY_DB_REMOTE,
      apiKey: config.apiKey ?? process.env.HEADLESSLY_API_KEY,
      format: config.format ?? 'json'
    }
  }

  /**
   * Find .db directory starting from current directory
   */
  private findDbDirectory(startPath?: string): string {
    let current = startPath ?? process.cwd()

    while (current !== '/') {
      const dbPath = join(current, '.db')
      if (existsSync(dbPath)) {
        return dbPath
      }

      const parent = resolve(current, '..')
      if (parent === current) break
      current = parent
    }

    // Default to .db in current directory (will be created on init)
    return join(process.cwd(), '.db')
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return existsSync(this.config.dbPath) && existsSync(this.config.schemaPath)
  }

  /**
   * Get configuration
   */
  getConfig(): DBConfig {
    return { ...this.config }
  }

  /**
   * Get database path
   */
  getDbPath(): string {
    return this.config.dbPath
  }

  /**
   * Get schema path
   */
  getSchemaPath(): string {
    return this.config.schemaPath
  }

  /**
   * Get data directory path for parquet files
   */
  getDataPath(): string {
    return this.config.dbPath
  }

  /**
   * Get remote endpoint
   */
  getRemote(): string | undefined {
    return this.config.remote
  }

  /**
   * Check if remote is configured
   */
  hasRemote(): boolean {
    return Boolean(this.config.remote && this.config.apiKey)
  }

  /**
   * Load schema information
   *
   * Reads the schema from .db/index.ts and extracts type definitions.
   * This is a simplified parser that extracts type names from the schema.
   */
  async loadSchema(): Promise<SchemaInfo> {
    if (this.schemaInfo) {
      return this.schemaInfo
    }

    if (!existsSync(this.config.schemaPath)) {
      throw new Error(`Schema file not found: ${this.config.schemaPath}`)
    }

    const source = readFileSync(this.config.schemaPath, 'utf-8')

    // Parse schema types from source
    // Look for patterns like: TypeName: { field: 'type', ... }
    const schema: Record<string, Record<string, string>> = {}
    const types: string[] = []

    // Simple regex-based extraction of type names
    // This is a basic implementation - for full parsing, use AST tools
    const typePattern = /^\s*(\w+):\s*\{/gm
    let match

    while ((match = typePattern.exec(source)) !== null) {
      const typeName = match[1]
      // Skip common non-type patterns
      if (['export', 'import', 'const', 'let', 'var', 'function'].includes(typeName)) {
        continue
      }
      types.push(typeName)
      schema[typeName] = {} // Would need full parsing for field details
    }

    // Also look for schema imports to find modular schema files
    const importPattern = /import\s*\{\s*(\w+Schema)\s*\}\s*from\s*['"]\.\/schema\/(\w+)['"]/g
    while ((match = importPattern.exec(source)) !== null) {
      const schemaFile = join(this.config.dbPath, 'schema', `${match[2]}.ts`)
      if (existsSync(schemaFile)) {
        const moduleSource = readFileSync(schemaFile, 'utf-8')
        let moduleMatch
        const moduleTypePattern = /^\s*(\w+):\s*\{/gm
        while ((moduleMatch = moduleTypePattern.exec(moduleSource)) !== null) {
          const typeName = moduleMatch[1]
          if (!['export', 'import', 'const', 'let', 'var', 'function'].includes(typeName)) {
            if (!types.includes(typeName)) {
              types.push(typeName)
            }
            schema[typeName] = {}
          }
        }
      }
    }

    this.schemaInfo = {
      types: types.sort(),
      schema,
      sourcePath: this.config.schemaPath
    }

    return this.schemaInfo
  }

  /**
   * Get list of entity types
   */
  async getTypes(): Promise<string[]> {
    const info = await this.loadSchema()
    return info.types
  }

  /**
   * Check if a type exists in the schema
   */
  async hasType(typeName: string): Promise<boolean> {
    const info = await this.loadSchema()
    return info.types.includes(typeName)
  }

  /**
   * Get parquet file path for a type
   */
  getTypeDataPath(typeName: string): string {
    const normalizedName = typeName.toLowerCase()
    return join(this.config.dbPath, `${normalizedName}.parquet`)
  }
}

// =============================================================================
// Global Context
// =============================================================================

let globalContext: DBContext | null = null

/**
 * Get or create the global database context
 */
export function getContext(options?: Partial<DBConfig>): DBContext {
  if (!globalContext || options) {
    globalContext = new DBContext(options)
  }
  return globalContext
}

/**
 * Reset the global context (for testing)
 */
export function resetContext(): void {
  globalContext = null
}
