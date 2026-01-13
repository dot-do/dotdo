/**
 * Scaffold Utility
 *
 * Generates default files for new dotdo projects.
 *
 * Files scaffolded:
 * - `.do/.gitignore` (ignores state/, *.db, *.db-wal, *.db-shm)
 * - `.do/state/` (directory)
 * - `.do/tsconfig.json` (MDX/TSX intellisense)
 * - `.do/mdx.d.ts` (MDXUI component types)
 * - `App.tsx` (in root by default, simple starter template)
 * - `do.config.ts` (optional, with defineConfig)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface ScaffoldOptions {
  /** Target directory for scaffolding (required) */
  targetDir: string
  /** Skip App.tsx creation */
  skipApp?: boolean
  /** Skip do.config.ts creation */
  skipConfig?: boolean
  /** Custom path for App.tsx (relative to targetDir, default: 'App.tsx') */
  appPath?: string
}

export interface ScaffoldResult {
  /** Files that were created */
  created: string[]
  /** Files that were skipped (already existed) */
  skipped: string[]
}

// ============================================================================
// Templates
// ============================================================================

const GITIGNORE_TEMPLATE = `# dotdo local state
state/

# SQLite database files
*.db
*.db-wal
*.db-shm

# Logs
*.log
`

const TSCONFIG_TEMPLATE = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    jsxImportSource: 'react',
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    types: ['react', 'react-dom'],
  },
  include: ['../**/*.tsx', '../**/*.ts', '*.d.ts'],
  exclude: ['../node_modules'],
}

const MDX_DTS_TEMPLATE = `/**
 * MDX Module Declarations
 *
 * Type definitions for MDX files to enable TypeScript intellisense
 * with MDXUI components.
 */

declare module '*.mdx' {
  import type { ComponentType } from 'react'

  const MDXComponent: ComponentType<{
    components?: Record<string, ComponentType<unknown>>
  }>

  export default MDXComponent

  // Frontmatter exports
  export const frontmatter: {
    title?: string
    description?: string
    [key: string]: unknown
  }
}

declare module '*.md' {
  import type { ComponentType } from 'react'

  const MDComponent: ComponentType<{
    components?: Record<string, ComponentType<unknown>>
  }>

  export default MDComponent
}
`

const APP_TSX_TEMPLATE = `/**
 * App Component
 *
 * Your dotdo application entry point.
 */

export default function App() {
  return (
    <div>
      <h1>Welcome to dotdo</h1>
      <p>Edit App.tsx to get started.</p>
    </div>
  )
}
`

const CONFIG_TEMPLATE = `/**
 * dotdo Configuration
 *
 * Configure your dotdo application settings.
 *
 * @see https://dotdo.dev/docs/config
 */

import { defineConfig } from 'dotdo'

export default defineConfig({
  // Application name
  name: 'my-app',

  // Entry point (default: 'App.tsx')
  // entryPoint: 'App.tsx',
})
`

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Write a file only if it doesn't exist (non-destructive)
 */
function writeFileIfNotExists(
  filePath: string,
  content: string,
  result: ScaffoldResult,
  relativePath: string
): void {
  if (fs.existsSync(filePath)) {
    result.skipped.push(relativePath)
    return
  }

  // Ensure parent directory exists
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(filePath, content, 'utf-8')
  result.created.push(relativePath)
}

/**
 * Create a directory if it doesn't exist
 */
function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Scaffold default files for a dotdo project
 *
 * This function is non-destructive and will never overwrite existing files.
 */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { targetDir, skipApp = false, skipConfig = false, appPath = 'App.tsx' } = options

  const result: ScaffoldResult = {
    created: [],
    skipped: [],
  }

  // Ensure target directory exists
  ensureDir(targetDir)

  // Create .do directory structure
  const dotDoDir = path.join(targetDir, '.do')
  ensureDir(dotDoDir)

  const stateDir = path.join(dotDoDir, 'state')
  ensureDir(stateDir)

  // Create .do/.gitignore
  writeFileIfNotExists(
    path.join(dotDoDir, '.gitignore'),
    GITIGNORE_TEMPLATE,
    result,
    '.do/.gitignore'
  )

  // Create .do/tsconfig.json
  writeFileIfNotExists(
    path.join(dotDoDir, 'tsconfig.json'),
    JSON.stringify(TSCONFIG_TEMPLATE, null, 2),
    result,
    '.do/tsconfig.json'
  )

  // Create .do/mdx.d.ts
  writeFileIfNotExists(
    path.join(dotDoDir, 'mdx.d.ts'),
    MDX_DTS_TEMPLATE,
    result,
    '.do/mdx.d.ts'
  )

  // Create App.tsx (unless skipped)
  if (!skipApp) {
    const appFilePath = path.join(targetDir, appPath)
    const appRelativePath = appPath
    writeFileIfNotExists(appFilePath, APP_TSX_TEMPLATE, result, appRelativePath)
  }

  // Create do.config.ts (unless skipped)
  if (!skipConfig) {
    writeFileIfNotExists(
      path.join(targetDir, 'do.config.ts'),
      CONFIG_TEMPLATE,
      result,
      'do.config.ts'
    )
  }

  return result
}
