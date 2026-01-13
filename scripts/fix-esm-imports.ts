#!/usr/bin/env tsx
/**
 * Post-build script to add .js extensions to relative imports in compiled JS files.
 * This is needed because TypeScript with moduleResolution: "bundler" doesn't add
 * extensions to the output, but Node.js ESM requires them.
 */

import { readdir, readFile, writeFile, stat, access } from 'fs/promises'
import { join, dirname, resolve } from 'path'

const DIST_DIR = join(process.cwd(), 'dist')

// Regex to match import/export statements with relative paths
// Matches: from './foo' or from '../bar' or from './baz/index'
const IMPORT_REGEX = /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function processFile(filePath: string): Promise<number> {
  const content = await readFile(filePath, 'utf-8')
  const fileDir = dirname(filePath)
  let modified = false
  let count = 0

  // We need to process async, so collect all matches first
  const matches: Array<{ match: string; prefix: string; path: string; suffix: string; index: number }> = []
  let match
  const regex = new RegExp(IMPORT_REGEX.source, 'g')
  while ((match = regex.exec(content)) !== null) {
    matches.push({
      match: match[0],
      prefix: match[1],
      path: match[2],
      suffix: match[3],
      index: match.index
    })
  }

  // Process in reverse to maintain indices
  let newContent = content
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!
    const { prefix, path, suffix, index, match: fullMatch } = m

    // Skip if already has .js extension
    if (path.endsWith('.js')) {
      continue
    }
    // Skip if it's a .json import
    if (path.endsWith('.json')) {
      continue
    }

    // Resolve the path relative to the file
    const absolutePath = resolve(fileDir, path)

    // Check if it's a directory with an index.js
    let newPath = path
    const indexPath = join(absolutePath, 'index.js')
    const directPath = absolutePath + '.js'

    if (await fileExists(indexPath)) {
      // It's a directory import, append /index.js
      newPath = path + '/index.js'
    } else if (await fileExists(directPath)) {
      // It's a file import, append .js
      newPath = path + '.js'
    } else {
      // Just append .js and hope for the best
      newPath = path + '.js'
    }

    const replacement = `${prefix}${newPath}${suffix}`
    newContent = newContent.slice(0, index) + replacement + newContent.slice(index + fullMatch.length)
    modified = true
    count++
  }

  if (modified) {
    await writeFile(filePath, newContent, 'utf-8')
  }

  return count
}

async function processDirectory(dir: string): Promise<{ files: number; imports: number }> {
  let totalFiles = 0
  let totalImports = 0

  const entries = await readdir(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stats = await stat(fullPath)

    if (stats.isDirectory()) {
      const result = await processDirectory(fullPath)
      totalFiles += result.files
      totalImports += result.imports
    } else if (entry.endsWith('.js')) {
      const count = await processFile(fullPath)
      if (count > 0) {
        totalFiles++
        totalImports += count
      }
    }
  }

  return { files: totalFiles, imports: totalImports }
}

async function main() {
  console.log('Adding .js extensions to relative imports in dist/...')

  try {
    const { files, imports } = await processDirectory(DIST_DIR)
    console.log(`Fixed ${imports} imports in ${files} files`)
  } catch (error) {
    console.error('Error processing files:', error)
    process.exit(1)
  }
}

main()
