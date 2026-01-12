#!/usr/bin/env node
/**
 * Fix .js references in .d.ts files (tsup bug with multi-entry builds)
 *
 * tsup generates declaration files that reference .js files instead of .d.ts files.
 * This script runs after tsup completes to fix those references.
 *
 * @see https://github.com/egoist/tsup/issues/700
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')

function fixDtsExtensions(dir) {
  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`)
    process.exit(1)
  }

  let fixedCount = 0
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      fixedCount += fixDtsExtensions(fullPath)
    } else if (entry.endsWith('.d.ts') || entry.endsWith('.d.cts')) {
      const content = readFileSync(fullPath, 'utf-8')

      // Replace .js and .cjs imports with extensionless imports in declaration files
      // TypeScript resolves .d.ts/.d.cts automatically when extension is omitted
      let fixed = content.replace(
        /from\s+['"]([^'"]+)\.js['"]/g,
        (match, path) => `from '${path}'`
      )
      fixed = fixed.replace(
        /from\s+['"]([^'"]+)\.cjs['"]/g,
        (match, path) => `from '${path}'`
      )

      if (fixed !== content) {
        writeFileSync(fullPath, fixed)
        fixedCount++
        console.log(`Fixed: ${fullPath}`)
      }
    }
  }

  return fixedCount
}

console.log('Fixing .d.ts file extensions...')
const count = fixDtsExtensions(distDir)
console.log(`Fixed ${count} declaration file(s)`)
