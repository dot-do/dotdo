/**
 * MDX Schema File Discovery
 *
 * Discovers DB.mdx schema files in a project directory.
 *
 * Discovery order (later files override earlier for same entities):
 * 1. DB.mdx in project root (base schema)
 * 2. .do/DB.mdx in project root (dotdo-specific overrides)
 * 3. *.do.mdx files anywhere in the project (per-entity definitions)
 *
 * Default exclusions:
 * - node_modules/
 * - .git/
 * - dist/
 * - build/
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseMdxSchema, type MdxSchema, type MdxEntity, type MdxFieldType } from './parser'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for schema file discovery
 */
export interface DiscoveryOptions {
  /** Additional glob patterns to exclude */
  exclude?: string[]
  /** Only include these patterns (overrides default discovery) */
  include?: string[]
  /** Maximum depth for *.do.mdx file search (default: 10) */
  maxDepth?: number
}

/**
 * Merged schema from multiple files
 */
export interface MergedMdxSchema {
  /** Merged entities from all schema files */
  entities: Record<string, MdxEntity>
  /** Source file paths that were merged */
  sources: string[]
  /** Merged frontmatter from all files (later files override) */
  frontmatter?: Record<string, unknown>
}

// ============================================================================
// Default Exclusions
// ============================================================================

const DEFAULT_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.cache',
  '.turbo',
]

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Check if a path matches an exclusion pattern
 */
function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Simple glob-like matching (supports ** for directories)
    const patternParts = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')
    const regex = new RegExp(`(^|/)${patternParts}(/|$)`)
    if (regex.test(filePath)) {
      return true
    }
  }
  return false
}

/**
 * Check if a path component is in the exclusion list
 */
function isExcludedDir(dirName: string): boolean {
  return DEFAULT_EXCLUDES.includes(dirName)
}

// ============================================================================
// Directory Traversal
// ============================================================================

/**
 * Recursively find files matching a pattern
 */
function findFilesRecursive(
  dir: string,
  pattern: RegExp,
  excludePatterns: string[],
  maxDepth: number,
  currentDepth: number = 0,
  results: string[] = []
): string[] {
  if (currentDepth > maxDepth) {
    return results
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    // Directory doesn't exist or can't be read
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip excluded directories
      if (isExcludedDir(entry.name)) {
        continue
      }

      // Check against custom exclude patterns
      if (matchesExcludePattern(fullPath, excludePatterns)) {
        continue
      }

      // Recurse into subdirectory
      findFilesRecursive(
        fullPath,
        pattern,
        excludePatterns,
        maxDepth,
        currentDepth + 1,
        results
      )
    } else if (entry.isFile()) {
      // Check if file matches pattern
      if (pattern.test(entry.name)) {
        // Check against custom exclude patterns
        if (!matchesExcludePattern(fullPath, excludePatterns)) {
          results.push(fullPath)
        }
      }
    }
  }

  return results
}

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Discover all MDX schema files in a project directory
 *
 * @param projectRoot - Root directory to search from
 * @param options - Discovery options
 * @returns Array of absolute file paths to schema files
 *
 * @example
 * ```typescript
 * const files = await discoverSchemaFiles('/path/to/project')
 * // ['/path/to/project/DB.mdx', '/path/to/project/.do/DB.mdx', '/path/to/project/src/User.do.mdx']
 * ```
 */
export async function discoverSchemaFiles(
  projectRoot: string,
  options: DiscoveryOptions = {}
): Promise<string[]> {
  const files: string[] = []
  const excludePatterns = options.exclude ?? []
  const maxDepth = options.maxDepth ?? 10

  // Check for root DB.mdx
  const rootDbMdx = path.join(projectRoot, 'DB.mdx')
  if (fs.existsSync(rootDbMdx)) {
    files.push(rootDbMdx)
  }

  // Check for .do/DB.mdx
  const doDbMdx = path.join(projectRoot, '.do', 'DB.mdx')
  if (fs.existsSync(doDbMdx)) {
    files.push(doDbMdx)
  }

  // Find all *.do.mdx files recursively
  const doMdxPattern = /\.do\.mdx$/
  const doMdxFiles = findFilesRecursive(
    projectRoot,
    doMdxPattern,
    excludePatterns,
    maxDepth
  )

  files.push(...doMdxFiles)

  return files
}

// ============================================================================
// Schema Loading and Merging
// ============================================================================

/**
 * Load a schema file and parse it
 */
async function loadSchemaFile(filePath: string): Promise<MdxSchema> {
  const content = fs.readFileSync(filePath, 'utf-8')
  return parseMdxSchema(content, filePath)
}

/**
 * Merge two entity definitions (later overrides earlier)
 */
function mergeEntities(
  base: MdxEntity | undefined,
  override: MdxEntity
): MdxEntity {
  if (!base) {
    return { ...override }
  }

  return {
    fields: { ...base.fields, ...override.fields },
    states: override.states ?? base.states,
    events: override.events ?? base.events,
    description: override.description ?? base.description,
  }
}

/**
 * Determine file priority for merging (higher number = higher priority)
 * Priority order: root DB.mdx (1) < .do/DB.mdx (2) < *.do.mdx (3)
 */
function getFilePriority(filePath: string): number {
  const basename = path.basename(filePath)
  const dirname = path.dirname(filePath)

  // *.do.mdx files have highest priority
  if (basename.endsWith('.do.mdx') && basename !== 'DB.mdx') {
    return 3
  }

  // .do/DB.mdx has medium priority
  if (basename === 'DB.mdx' && path.basename(dirname) === '.do') {
    return 2
  }

  // Root DB.mdx has lowest priority
  if (basename === 'DB.mdx') {
    return 1
  }

  return 0
}

/**
 * Load and merge all schema files in a project
 *
 * @param projectRoot - Root directory to search from
 * @param options - Discovery options
 * @returns Merged schema from all discovered files
 *
 * @example
 * ```typescript
 * const schema = await loadAndMergeSchemas('/path/to/project')
 *
 * // Access merged entities
 * console.log(schema.entities.User)
 *
 * // See which files contributed
 * console.log(schema.sources)
 * ```
 */
export async function loadAndMergeSchemas(
  projectRoot: string,
  options: DiscoveryOptions = {}
): Promise<MergedMdxSchema> {
  const files = await discoverSchemaFiles(projectRoot, options)

  if (files.length === 0) {
    return {
      entities: {},
      sources: [],
    }
  }

  // Sort files by priority (lower priority first so higher can override)
  const sortedFiles = [...files].sort(
    (a, b) => getFilePriority(a) - getFilePriority(b)
  )

  // Load and merge all schemas
  const merged: MergedMdxSchema = {
    entities: {},
    sources: [],
    frontmatter: {},
  }

  for (const filePath of sortedFiles) {
    const schema = await loadSchemaFile(filePath)
    merged.sources.push(filePath)

    // Merge frontmatter
    if (schema.frontmatter) {
      merged.frontmatter = { ...merged.frontmatter, ...schema.frontmatter }
    }

    // Merge entities
    for (const [entityName, entity] of Object.entries(schema.entities)) {
      merged.entities[entityName] = mergeEntities(
        merged.entities[entityName],
        entity
      )
    }
  }

  return merged
}
