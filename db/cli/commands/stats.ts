/**
 * Stats Command - Show database statistics
 */

import { existsSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ParsedArgs } from '../types'
import { print, printError, printJson, colorize, printTable } from '../types'
import { getContext } from '../db-context'

/**
 * Show database statistics
 *
 * Usage:
 *   db stats
 *   db stats Organization
 */
export async function statsCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()

  if (!ctx.isInitialized()) {
    printError('Database not initialized. Run `db init` first.')
    return 1
  }

  const typeName = args.args[0]

  try {
    if (typeName) {
      // Stats for specific type
      return await showTypeStats(ctx, typeName, args)
    } else {
      // Overall database stats
      return await showDatabaseStats(ctx, args)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    printError(`Failed to get stats: ${message}`)
    return 1
  }
}

/**
 * Show overall database statistics
 */
async function showDatabaseStats(
  ctx: ReturnType<typeof getContext>,
  args: ParsedArgs
): Promise<number> {
  const dbPath = ctx.getDbPath()
  const types = await ctx.getTypes()

  // Gather stats
  const stats = {
    path: dbPath,
    types: types.length,
    files: 0,
    totalSize: 0,
    byType: [] as Array<{ type: string; size: number; exists: boolean }>
  }

  // Check each type's data file
  for (const type of types) {
    const dataPath = ctx.getTypeDataPath(type)
    const exists = existsSync(dataPath)
    let size = 0

    if (exists) {
      const stat = statSync(dataPath)
      size = stat.size
      stats.files++
      stats.totalSize += size
    }

    stats.byType.push({ type, size, exists })
  }

  // JSON output
  if (args.options.json) {
    printJson(stats)
    return 0
  }

  // Pretty output
  print(colorize('Database Statistics', 'bold'))
  print(colorize(`Path: ${dbPath}`, 'dim'))
  print('')
  print(`Types:       ${stats.types}`)
  print(`Data files:  ${stats.files}`)
  print(`Total size:  ${formatBytes(stats.totalSize)}`)
  print('')

  // Type breakdown
  if (stats.byType.length > 0) {
    print(colorize('Types:', 'cyan'))

    const rows = stats.byType
      .filter((t) => t.exists)
      .map((t) => ({
        Type: t.type,
        Size: formatBytes(t.size)
      }))

    if (rows.length > 0) {
      printTable(rows)
    } else {
      print(colorize('  No data files yet', 'dim'))
    }

    // Show types without data
    const emptyTypes = stats.byType.filter((t) => !t.exists)
    if (emptyTypes.length > 0 && !args.options.brief) {
      print('')
      print(colorize('Types without data:', 'dim'))
      print(`  ${emptyTypes.map((t) => t.type).join(', ')}`)
    }
  }

  return 0
}

/**
 * Show statistics for a specific type
 */
async function showTypeStats(
  ctx: ReturnType<typeof getContext>,
  typeName: string,
  args: ParsedArgs
): Promise<number> {
  // Validate type exists
  if (!(await ctx.hasType(typeName))) {
    printError(`Unknown type: ${typeName}`)
    const types = await ctx.getTypes()
    print(`Available types: ${types.join(', ')}`)
    return 1
  }

  const dataPath = ctx.getTypeDataPath(typeName)
  const exists = existsSync(dataPath)

  const stats = {
    type: typeName,
    path: dataPath,
    exists,
    size: 0,
    count: 0,
    lastModified: null as string | null
  }

  if (exists) {
    const stat = statSync(dataPath)
    stats.size = stat.size
    stats.lastModified = stat.mtime.toISOString()

    // In real implementation, would read parquet metadata for row count
    // stats.count = getRowCount(dataPath)
  }

  // JSON output
  if (args.options.json) {
    printJson(stats)
    return 0
  }

  // Pretty output
  print(colorize(`${typeName} Statistics`, 'bold'))
  print('')

  if (!exists) {
    print(colorize('No data file exists yet', 'yellow'))
    print(`Run \`db create ${typeName} <data>\` to add data`)
    return 0
  }

  print(`Path:          ${dataPath}`)
  print(`Size:          ${formatBytes(stats.size)}`)
  print(`Records:       ${stats.count || '(parquet scan needed)'}`)
  print(`Last modified: ${stats.lastModified}`)

  return 0
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)

  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}
