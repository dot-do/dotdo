/**
 * Doctor Command - Validate schema and data integrity
 */

import { existsSync, statSync } from 'fs'
import type { ParsedArgs } from '../types'
import { print, printError, printSuccess, printWarning, colorize } from '../types'
import { getContext } from '../db-context'

/**
 * Diagnostic checks for database health
 */
interface DiagnosticResult {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: string
}

/**
 * Run diagnostic checks on the database
 *
 * Usage:
 *   db doctor
 *   db doctor --fix
 */
export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const ctx = getContext()
  const results: DiagnosticResult[] = []
  const autoFix = args.options.fix === true

  print(colorize('Running diagnostics...', 'bold'))
  print('')

  // Check 1: Database initialized
  const dbPath = ctx.getDbPath()
  if (!existsSync(dbPath)) {
    results.push({
      name: 'Database directory',
      status: 'fail',
      message: `.db directory not found at ${dbPath}`,
      details: 'Run `db init` to initialize'
    })
  } else {
    results.push({
      name: 'Database directory',
      status: 'pass',
      message: `Found at ${dbPath}`
    })
  }

  // Check 2: Schema file exists
  const schemaPath = ctx.getSchemaPath()
  if (!existsSync(schemaPath)) {
    results.push({
      name: 'Schema file',
      status: 'fail',
      message: 'index.ts not found',
      details: 'Create .db/index.ts with your schema'
    })
  } else {
    // Check 3: Schema is valid
    try {
      const schemaInfo = await ctx.loadSchema()

      if (schemaInfo.types.length === 0) {
        results.push({
          name: 'Schema file',
          status: 'warn',
          message: 'Schema is empty (no types defined)',
          details: 'Add entity types to .db/index.ts'
        })
      } else {
        results.push({
          name: 'Schema file',
          status: 'pass',
          message: `Found ${schemaInfo.types.length} types`
        })
      }

      // Check 4: Type naming conventions
      const issues: string[] = []
      for (const type of schemaInfo.types) {
        // Check PascalCase
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(type)) {
          issues.push(`${type} should be PascalCase`)
        }
      }

      if (issues.length > 0) {
        results.push({
          name: 'Type naming',
          status: 'warn',
          message: `${issues.length} naming issue(s)`,
          details: issues.join(', ')
        })
      } else {
        results.push({
          name: 'Type naming',
          status: 'pass',
          message: 'All types follow naming conventions'
        })
      }

      // Check 5: Data files integrity
      let dataFilesOk = 0
      let dataFilesMissing = 0

      for (const type of schemaInfo.types) {
        const dataPath = ctx.getTypeDataPath(type)
        if (existsSync(dataPath)) {
          dataFilesOk++
          // Could add parquet validation here
        } else {
          dataFilesMissing++
        }
      }

      if (dataFilesOk > 0) {
        results.push({
          name: 'Data files',
          status: 'pass',
          message: `${dataFilesOk} type(s) have data`
        })
      }
      if (dataFilesMissing > 0) {
        results.push({
          name: 'Data files',
          status: 'warn',
          message: `${dataFilesMissing} type(s) have no data yet`,
          details: 'This is normal for unused types'
        })
      }
    } catch (error) {
      results.push({
        name: 'Schema file',
        status: 'fail',
        message: 'Failed to parse schema',
        details: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // Check 6: Remote configuration
  if (ctx.hasRemote()) {
    results.push({
      name: 'Remote sync',
      status: 'pass',
      message: `Configured: ${ctx.getRemote()}`
    })
  } else {
    results.push({
      name: 'Remote sync',
      status: 'warn',
      message: 'Not configured',
      details: 'Set HEADLESSLY_DB_REMOTE for sync features'
    })
  }

  // Print results
  print(colorize('Results:', 'bold'))
  print('')

  let hasFailures = false
  let hasWarnings = false

  for (const result of results) {
    const icon =
      result.status === 'pass'
        ? colorize('✓', 'green')
        : result.status === 'warn'
          ? colorize('⚠', 'yellow')
          : colorize('✗', 'red')

    const nameColor =
      result.status === 'pass'
        ? 'green'
        : result.status === 'warn'
          ? 'yellow'
          : 'red'

    print(`${icon} ${colorize(result.name, nameColor as 'green' | 'yellow' | 'red')}: ${result.message}`)

    if (result.details) {
      print(colorize(`    ${result.details}`, 'dim'))
    }

    if (result.status === 'fail') hasFailures = true
    if (result.status === 'warn') hasWarnings = true
  }

  print('')

  // Summary
  if (hasFailures) {
    printError('Database has issues that need attention')
    return 1
  } else if (hasWarnings) {
    printWarning('Database is functional but has warnings')
    return 0
  } else {
    printSuccess('Database is healthy')
    return 0
  }
}
