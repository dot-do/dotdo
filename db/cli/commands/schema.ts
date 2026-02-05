/**
 * Schema Command - Show/validate schema
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { ParsedArgs } from '../types'
import {
  print,
  printSuccess,
  printError,
  printJson,
  colorize
} from '../types'
import { getContext } from '../db-context'

/**
 * Show or validate the database schema
 */
export async function schemaCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const subcommand = args.args[0] ?? 'show'

  switch (subcommand) {
    case 'show':
      return showSchema(args)
    case 'validate':
      return validateSchema(args)
    case 'diff':
      return diffSchema(args)
    default:
      printError(`Unknown subcommand: ${subcommand}`)
      print('Available: show, validate, diff')
      return 1
  }
}

/**
 * Show the current schema
 */
async function showSchema(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  try {
    const schemaInfo = await ctx.loadSchema()

    if (args.options.json) {
      printJson({
        types: schemaInfo.types,
        source: schemaInfo.sourcePath
      })
      return 0
    }

    print(colorize('Database Schema', 'bold'))
    print(colorize(`Source: ${schemaInfo.sourcePath}`, 'dim'))
    print('')

    // Group by category if we can detect it
    const categories = groupTypesByCategory(schemaInfo.types)

    for (const [category, types] of categories) {
      if (category !== 'Other') {
        print(colorize(`${category}:`, 'cyan'))
      }
      for (const type of types) {
        print(`  - ${type}`)
      }
      print('')
    }

    print(colorize(`Total: ${schemaInfo.types.length} types`, 'dim'))

    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to load schema: ${message}`)
    return 1
  }
}

/**
 * Validate the schema
 */
async function validateSchema(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  try {
    const schemaInfo = await ctx.loadSchema()

    // Basic validation - check for types
    if (schemaInfo.types.length === 0) {
      printError('No types found in schema')
      return 1
    }

    // Check for common issues
    const issues: string[] = []

    // Check for reserved names
    const reserved = ['Event', 'Error', 'Object', 'Array', 'String', 'Number', 'Boolean']
    for (const type of schemaInfo.types) {
      if (reserved.includes(type)) {
        issues.push(`Type "${type}" conflicts with a reserved name`)
      }
    }

    // Check for duplicate types (case-insensitive)
    const lowerTypes = schemaInfo.types.map((t) => t.toLowerCase())
    const duplicates = lowerTypes.filter(
      (t, i) => lowerTypes.indexOf(t) !== i
    )
    for (const dup of duplicates) {
      issues.push(`Duplicate type (case-insensitive): "${dup}"`)
    }

    if (issues.length > 0) {
      print(colorize('Validation Issues:', 'yellow'))
      for (const issue of issues) {
        print(`  - ${issue}`)
      }
      return 1
    }

    printSuccess(`Schema valid: ${schemaInfo.types.length} types`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Schema validation failed: ${message}`)
    return 1
  }
}

/**
 * Show diff between local and remote schema
 */
async function diffSchema(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.hasRemote()) {
    printError('No remote configured. Set HEADLESSLY_DB_REMOTE.')
    return 1
  }

  print('Schema diff not yet implemented')
  return 0
}

/**
 * Group types by category based on naming conventions
 */
function groupTypesByCategory(types: string[]): Map<string, string[]> {
  const categories = new Map<string, string[]>()

  // Known categories from headless.ly schema
  const categoryMap: Record<string, string[]> = {
    Meta: ['Noun', 'Verb', 'Action', 'Event'],
    CRM: [
      'Organization',
      'Contact',
      'Lead',
      'Deal',
      'Activity',
      'Campaign',
      'Pipeline'
    ],
    CMS: ['Site', 'Page', 'Post', 'Category', 'Asset', 'Folder', 'Menu', 'Redirect'],
    Standards: [
      'Industry',
      'Occupation',
      'Skill',
      'Task',
      'Ability',
      'Process',
      'Department',
      'ProductCategory',
      'OccupationSkill',
      'OccupationTask',
      'OccupationAbility',
      'IndustryOccupation'
    ],
    Systems: [
      'System',
      'SystemAction',
      'Integration',
      'Connection',
      'Workflow',
      'WorkflowRun',
      'Webhook',
      'ApiKey'
    ],
    Products: [
      'Product',
      'Plan',
      'Price',
      'Subscription',
      'UsageRecord',
      'Invoice',
      'Coupon',
      'Discount',
      'PaymentMethod',
      'TaxRate'
    ]
  }

  // Reverse the map
  const typeToCategory = new Map<string, string>()
  for (const [category, categoryTypes] of Object.entries(categoryMap)) {
    for (const type of categoryTypes) {
      typeToCategory.set(type, category)
    }
  }

  // Group types
  for (const type of types) {
    const category = typeToCategory.get(type) ?? 'Other'
    const list = categories.get(category) ?? []
    list.push(type)
    categories.set(category, list)
  }

  return categories
}
