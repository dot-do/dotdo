/**
 * Fix cross-package relative imports
 *
 * This script replaces relative parent traversals with workspace imports.
 * Run with: npx tsx scripts/fix-imports.ts
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative, dirname, basename } from 'path'

const ROOT_DIR = join(import.meta.dirname, '..')

// Import replacement patterns
const REPLACEMENTS: [RegExp, string][] = [
  // db imports
  [/from ['"]\.\.\/db['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/\.\.\/db['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/db\/things['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/db\/events['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/db\/relationships['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/db\/sqlite['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/\.\.\/db\/things['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/\.\.\/db\/events['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/\.\.\/db\/relationships['"]/g, "from '@dotdo/db'"],
  [/from ['"]\.\.\/\.\.\/db['"]/g, "from '@dotdo/db'"],

  // rpc imports
  [/from ['"]\.\.\/rpc\/errors['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/rpc\/logging['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/rpc\/client['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/rpc\/batch-rpc['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/rpc['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/\.\.\/rpc\/errors['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/\.\.\/rpc\/logging['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/\.\.\/rpc\/client['"]/g, "from '@dotdo/rpc'"],
  [/from ['"]\.\.\/\.\.\/rpc['"]/g, "from '@dotdo/rpc'"],

  // auth imports
  [/from ['"]\.\.\/auth\/middleware['"]/g, "from '@dotdo/auth'"],
  [/from ['"]\.\.\/auth\/token['"]/g, "from '@dotdo/auth'"],
  [/from ['"]\.\.\/auth\/jwks['"]/g, "from '@dotdo/auth'"],
  [/from ['"]\.\.\/auth\/validation['"]/g, "from '@dotdo/auth'"],
  [/from ['"]\.\.\/auth['"]/g, "from '@dotdo/auth'"],
  [/from ['"]\.\.\/\.\.\/auth['"]/g, "from '@dotdo/auth'"],

  // utils imports
  [/from ['"]\.\.\/utils\/logger['"]/g, "from '@dotdo/utils'"],
  [/from ['"]\.\.\/\.\.\/utils\/logger['"]/g, "from '@dotdo/utils'"],
  [/from ['"]\.\.\/utils['"]/g, "from '@dotdo/utils'"],

  // integrations imports
  [/from ['"]\.\.\/integrations['"]/g, "from '@dotdo/integrations'"],
  [/from ['"]\.\.\/integrations\/stripe['"]/g, "from '@dotdo/integrations/stripe'"],
  [/from ['"]\.\.\/integrations\/sendgrid['"]/g, "from '@dotdo/integrations/sendgrid'"],
  [/from ['"]\.\.\/\.\.\/integrations['"]/g, "from '@dotdo/integrations'"],

  // test-utils imports
  [/from ['"]\.\.\/test-utils['"]/g, "from '@dotdo/test-utils'"],
  [/from ['"]\.\.\/\.\.\/test-utils['"]/g, "from '@dotdo/test-utils'"],

  // do imports (from api/mcp)
  [/from ['"]\.\.\/do\/context['"]/g, "from '@dotdo/do'"],
  [/from ['"]\.\.\/\.\.\/do\/context['"]/g, "from '@dotdo/do'"],
]

// Directories to process
const SOURCE_DIRS = ['do', 'api', 'mcp']

// Directories to skip
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.worktrees', 'primitives', 'tests'])

// Files to skip
const IGNORE_FILES = new Set(['_worker-entry.ts'])

function findTypeScriptFiles(dir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue

      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        files.push(...findTypeScriptFiles(fullPath))
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !IGNORE_FILES.has(entry)) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files
}

function fixFile(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8')
  let newContent = content

  for (const [pattern, replacement] of REPLACEMENTS) {
    newContent = newContent.replace(pattern, replacement)
  }

  if (newContent !== content) {
    writeFileSync(filePath, newContent)
    console.log(`Fixed: ${relative(ROOT_DIR, filePath)}`)
    return true
  }

  return false
}

// Main
let fixedCount = 0

for (const dir of SOURCE_DIRS) {
  const dirPath = join(ROOT_DIR, dir)
  const files = findTypeScriptFiles(dirPath)

  for (const file of files) {
    if (fixFile(file)) {
      fixedCount++
    }
  }
}

console.log(`\nFixed ${fixedCount} files.`)
