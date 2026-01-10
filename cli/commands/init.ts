/**
 * Init Command
 *
 * Scaffolds a new dotdo project with the proper structure.
 *
 * Usage:
 *   npx dotdo init my-startup    # Create new project directory
 *   npx dotdo init .             # Initialize in current directory
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ============================================================================
// Command Metadata
// ============================================================================

export const name = 'init'
export const description = 'Initialize a new dotdo project'

// ============================================================================
// Types
// ============================================================================

export interface InitOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert kebab-case or snake_case to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

/**
 * Validate project name
 */
function validateProjectName(name: string): void {
  // Allow "." for current directory
  if (name === '.') return

  // Check for valid npm package name (simplified)
  const validNamePattern = /^[a-z][a-z0-9-]*$/

  if (!validNamePattern.test(name)) {
    throw new Error(`Invalid project name: "${name}". Must start with a letter and contain only lowercase letters, numbers, and hyphens.`)
  }
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Generate src/index.ts content
 */
function generateIndexTs(className: string): string {
  return `/**
 * ${className} - A dotdo Startup
 *
 * Build your 1-Person Unicorn.
 */

import { DO } from 'dotdo'

export class ${className} extends DO {
  static readonly $type = '${className}'
}

// Re-export the simple worker as default
export { default } from 'dotdo/workers/simple'
`
}

/**
 * Generate wrangler.jsonc content
 */
function generateWranglerJsonc(projectName: string, className: string): string {
  return `{
  "$schema": "https://raw.githubusercontent.com/cloudflare/workers-sdk/main/packages/wrangler/config-schema.json",
  "name": "${projectName}",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],

  // Durable Objects
  "durable_objects": {
    "bindings": [
      {
        "name": "DO",
        "class_name": "${className}",
        "script_name": "${projectName}"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["${className}"]
    }
  ]
}
`
}

/**
 * Generate package.json content
 */
function generatePackageJson(projectName: string): string {
  const pkg = {
    name: projectName,
    version: '0.0.1',
    private: true,
    type: 'module',
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      dotdo: '^0.1.0',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.20241230.0',
      typescript: '^5.7.0',
      wrangler: '^3.99.0',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/**
 * Generate tsconfig.json content
 */
function generateTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      lib: ['ES2022'],
      types: ['@cloudflare/workers-types'],
    },
    include: ['src/**/*'],
    exclude: ['node_modules'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Run the init command
 */
export async function run(args: string[], options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()

  // Get project name from args
  const projectName = args[0]

  if (!projectName) {
    throw new Error('Please provide a project name: npx dotdo init <project-name>')
  }

  // Validate project name
  validateProjectName(projectName)

  // Determine project directory and name for files
  let projectDir: string
  let actualProjectName: string

  if (projectName === '.') {
    // Initialize in current directory
    projectDir = cwd
    actualProjectName = path.basename(cwd)
  } else {
    // Create new directory
    projectDir = path.join(cwd, projectName)
    actualProjectName = projectName

    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      throw new Error(`Directory "${projectName}" already exists. Please choose a different name or remove the existing directory.`)
    }

    // Create project directory
    fs.mkdirSync(projectDir, { recursive: true })
  }

  // Derive class name from project name
  const className = toPascalCase(actualProjectName)

  // Create src directory
  const srcDir = path.join(projectDir, 'src')
  fs.mkdirSync(srcDir, { recursive: true })

  // Write files
  fs.writeFileSync(
    path.join(srcDir, 'index.ts'),
    generateIndexTs(className)
  )

  fs.writeFileSync(
    path.join(projectDir, 'wrangler.jsonc'),
    generateWranglerJsonc(actualProjectName, className)
  )

  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    generatePackageJson(actualProjectName)
  )

  fs.writeFileSync(
    path.join(projectDir, 'tsconfig.json'),
    generateTsconfig()
  )

  // Print success message
  console.log(`\nProject "${actualProjectName}" created successfully!\n`)
  console.log('Next steps:')

  if (projectName !== '.') {
    console.log(`  cd ${projectName}`)
  }

  console.log('  npm install')
  console.log('  npm run dev')
  console.log('')
}
