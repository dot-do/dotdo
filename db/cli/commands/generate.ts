/**
 * Generate Command - Generate TypeScript types from schema
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { ParsedArgs } from '../types'
import { print, printError, printSuccess, spinner, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Generate TypeScript types from schema
 *
 * Usage:
 *   db generate
 *   db generate --output ./types/db.ts
 */
export async function generateCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  try {
    const s = spinner('Generating TypeScript types...')

    const schemaInfo = await ctx.loadSchema()

    // Generate TypeScript types
    const output = generateTypes(schemaInfo.types)

    s.stop()

    // Determine output path
    const outputPath = args.options.output
      ? String(args.options.output)
      : join(ctx.getDbPath(), 'types.ts')

    // Ensure directory exists
    const outputDir = dirname(outputPath)
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    // Write output
    writeFileSync(outputPath, output)

    printSuccess(`Generated types at ${outputPath}`)
    print('')
    print(colorize('Usage:', 'bold'))
    print(`  import type { Organization, Contact } from '${outputPath}'`)

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Generation failed: ${message}`)
    return 1
  }
}

/**
 * Generate TypeScript type definitions
 */
function generateTypes(types: string[]): string {
  const lines: string[] = []

  // Header
  lines.push('/**')
  lines.push(' * Auto-generated TypeScript types for database schema')
  lines.push(` * Generated: ${new Date().toISOString()}`)
  lines.push(' *')
  lines.push(' * DO NOT EDIT - regenerate with `db generate`')
  lines.push(' */')
  lines.push('')

  // Base entity type
  lines.push('/**')
  lines.push(' * Base entity fields present on all entities')
  lines.push(' */')
  lines.push('export interface BaseEntity {')
  lines.push('  /** Unique identifier */')
  lines.push('  $id: string')
  lines.push('  /** Entity type name */')
  lines.push('  $type: string')
  lines.push('  /** Creation timestamp */')
  lines.push('  $createdAt: string')
  lines.push('  /** Last update timestamp */')
  lines.push('  $updatedAt: string')
  lines.push('}')
  lines.push('')

  // Entity types
  // Note: This is a simplified version - full implementation would parse
  // the schema to generate proper typed fields
  for (const typeName of types) {
    lines.push(`/**`)
    lines.push(` * ${typeName} entity`)
    lines.push(` */`)
    lines.push(`export interface ${typeName} extends BaseEntity {`)
    lines.push(`  $type: '${typeName}'`)
    lines.push(`  // Fields defined in schema`)
    lines.push(`  [key: string]: unknown`)
    lines.push(`}`)
    lines.push('')
  }

  // Union type of all entities
  lines.push('/**')
  lines.push(' * Union type of all entity types')
  lines.push(' */')
  lines.push(`export type AnyEntity = ${types.join(' | ')}`)
  lines.push('')

  // Type name union
  lines.push('/**')
  lines.push(' * Union of all type names')
  lines.push(' */')
  lines.push(`export type EntityTypeName = ${types.map((t) => `'${t}'`).join(' | ')}`)
  lines.push('')

  // Type map
  lines.push('/**')
  lines.push(' * Map from type name to entity interface')
  lines.push(' */')
  lines.push('export interface EntityTypeMap {')
  for (const typeName of types) {
    lines.push(`  ${typeName}: ${typeName}`)
  }
  lines.push('}')
  lines.push('')

  // Entity input types (for create/update)
  lines.push('/**')
  lines.push(' * Input type for creating entities (excludes auto-generated fields)')
  lines.push(' */')
  lines.push(`export type EntityInput<T extends AnyEntity> = Omit<T, '$id' | '$type' | '$createdAt' | '$updatedAt'> & {`)
  lines.push(`  $id?: string`)
  lines.push(`}`)
  lines.push('')

  // Export list
  lines.push('/**')
  lines.push(' * List of all entity type names')
  lines.push(' */')
  lines.push(`export const entityTypes = [`)
  for (const typeName of types) {
    lines.push(`  '${typeName}',`)
  }
  lines.push(`] as const`)
  lines.push('')

  return lines.join('\n')
}
