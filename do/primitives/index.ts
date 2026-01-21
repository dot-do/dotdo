/**
 * @dotdo/do/primitives - Extended Primitives for Durable Objects
 *
 * This module provides type definitions and documentation for the extended
 * primitives that can be wired into the WorkflowContext ($).
 *
 * ## Naming Conventions
 *
 * All primitives follow consistent naming:
 * - **FSX** (File System eXtended) - File system operations from `fsx.do`
 * - **GitX** (Git eXtended) - Git operations from `gitx.do`
 * - **BashX** (Bash eXtended) - Shell command execution from `bashx.do`
 * - **NpmX** (NPM eXtended) - Package management from `npmx.do`
 *
 * ## Usage
 *
 * Primitives are optional capabilities that can be wired into the $ context:
 *
 * ```typescript
 * import { createContext, type FsCapability, type GitCapability, type BashCapability } from '@dotdo/do'
 * import { FsModule } from 'fsx.do'
 * import { GitModule } from 'gitx.do'
 * import { BashModule } from 'bashx.do'
 *
 * // In your DO constructor
 * const fs = new FsModule(state)
 * const git = new GitModule(state)
 * const bash = new BashModule()
 *
 * const $ = createContext(state, env, { fs, git, bash })
 *
 * // Now use primitives via $
 * await $.fs.writeFile('/config.json', JSON.stringify(config))
 * await $.git.commit('Update config')
 * await $.bash.exec('npm', ['install'])
 * ```
 *
 * ## Package Dependencies
 *
 * Install the primitives you need:
 *
 * ```bash
 * # File system operations
 * npm install fsx.do
 *
 * # Git operations
 * npm install gitx.do
 *
 * # Bash/shell execution
 * npm install bashx.do
 *
 * # NPM/NPX operations
 * npm install npmx.do
 * ```
 *
 * @packageDocumentation
 * @module @dotdo/do/primitives
 */

// =============================================================================
// CAPABILITY INTERFACES
// =============================================================================

/**
 * Re-export capability interfaces from the workflow context.
 * These define the contract that primitive implementations must satisfy.
 */
export type {
  FsCapability,
  GitCapability,
  BashCapability,
} from '../workflow/context'

// =============================================================================
// FSX - FILE SYSTEM EXTENDED
// =============================================================================

/**
 * FSX (File System eXtended) provides POSIX-compatible filesystem operations.
 *
 * ## Features
 * - POSIX-like API (readFile, writeFile, mkdir, etc.)
 * - Tiered storage (hot/warm/cold)
 * - Content-addressable storage (CAS)
 * - Glob pattern matching
 * - File search with grep
 *
 * ## Package: `fsx.do`
 *
 * ```typescript
 * import { FSx, MemoryBackend, glob, grep, find } from 'fsx.do'
 *
 * // Create filesystem with memory backend
 * const backend = new MemoryBackend()
 * const fs = new FSx(backend)
 *
 * // Basic operations
 * await fs.writeFile('/hello.txt', 'Hello, World!')
 * const content = await fs.readFile('/hello.txt', { encoding: 'utf-8' })
 *
 * // Glob pattern matching
 * const files = await glob('**\/*.ts', { fs })
 *
 * // Content search
 * const matches = await grep('TODO', '/src', { fs })
 * ```
 *
 * @see https://fsx.do for full documentation
 */
export interface FSX {
  /** Package name for installation */
  readonly package: 'fsx.do'
  /** Capability name when wired to $ context */
  readonly capability: 'fs'
}

// =============================================================================
// GITX - GIT EXTENDED
// =============================================================================

/**
 * GitX (Git eXtended) provides complete Git implementation for Workers.
 *
 * ## Features
 * - Complete Git object model (blob, tree, commit, tag)
 * - Packfile format and delta compression
 * - Merge, blame, and branch operations
 * - Git Smart HTTP protocol (fetch, push)
 * - R2 packfile storage
 *
 * ## Package: `gitx.do`
 *
 * ```typescript
 * import { createCommit, merge, blame } from 'gitx.do'
 *
 * // Create a commit
 * const commit = await createCommit(storage, {
 *   tree: treeSha,
 *   parents: [parentSha],
 *   message: 'Add new feature',
 *   author: { name: 'Alice', email: 'alice@example.com' }
 * })
 *
 * // Merge branches
 * const result = await merge(storage, 'feature', 'main')
 *
 * // Get blame info
 * const blameInfo = await blame(storage, '/src/index.ts')
 * ```
 *
 * @see https://gitx.do for full documentation
 */
export interface GitX {
  /** Package name for installation */
  readonly package: 'gitx.do'
  /** Capability name when wired to $ context */
  readonly capability: 'git'
}

// =============================================================================
// BASHX - BASH EXTENDED
// =============================================================================

/**
 * BashX (Bash eXtended) provides AI-enhanced bash with safety analysis.
 *
 * ## Features
 * - AST-based command parsing (tree-sitter-bash)
 * - Safety classification (structural, not regex)
 * - Intent analysis and suggestions
 * - Dangerous command blocking
 * - Undo tracking for reversible operations
 *
 * ## Package: `bashx.do`
 *
 * ```typescript
 * import { bash } from 'bashx.do'
 *
 * // Execute commands
 * const result = await bash`ls -la`
 *
 * // Natural language intent
 * const files = await bash`find all typescript files over 100 lines`
 *
 * // Dangerous commands are blocked
 * const blocked = await bash`rm -rf /`  // { blocked: true }
 *
 * // Execute with confirmation
 * await bash('rm -rf ./temp', { confirm: true })
 *
 * // Shell-safe interpolation
 * const file = 'my file.txt'
 * await bash`cat ${file}`  // cat 'my file.txt' (escaped)
 * ```
 *
 * @see https://bashx.do for full documentation
 */
export interface BashX {
  /** Package name for installation */
  readonly package: 'bashx.do'
  /** Capability name when wired to $ context */
  readonly capability: 'bash'
}

// =============================================================================
// NPMX - NPM EXTENDED
// =============================================================================

/**
 * NpmX (NPM eXtended) provides NPM/NPX for edge runtimes.
 *
 * ## Features
 * - npm install in Workers (no Node.js required)
 * - npx command execution
 * - Semver resolution
 * - Package.json handling
 * - Tarball extraction
 *
 * ## Package: `npmx.do`
 *
 * ```typescript
 * import { npm, npx } from 'npmx.do'
 *
 * // Install packages at runtime
 * await npm.install(['lodash', 'react@18'])
 *
 * // Run npx commands
 * await npx('cowsay', ['hello'])
 *
 * // Get package info
 * const info = await npm.info('react')
 * ```
 *
 * @see https://npmx.do for full documentation
 */
export interface NpmX {
  /** Package name for installation */
  readonly package: 'npmx.do'
  /** Capability name when wired to $ context */
  readonly capability: 'npm'
}

// =============================================================================
// PRIMITIVE REGISTRY
// =============================================================================

/**
 * Registry of all available primitives with their metadata.
 *
 * Use this to discover available primitives and their capabilities:
 *
 * ```typescript
 * import { PRIMITIVES } from '@dotdo/do/primitives'
 *
 * console.log(PRIMITIVES)
 * // {
 * //   fsx: { package: 'fsx.do', capability: 'fs', ... },
 * //   gitx: { package: 'gitx.do', capability: 'git', ... },
 * //   bashx: { package: 'bashx.do', capability: 'bash', ... },
 * //   npmx: { package: 'npmx.do', capability: 'npm', ... },
 * // }
 * ```
 */
export const PRIMITIVES = {
  /**
   * FSX - File System eXtended
   * POSIX-compatible filesystem for Workers
   */
  fsx: {
    package: 'fsx.do',
    capability: 'fs',
    description: 'POSIX-compatible filesystem with tiered storage',
    features: ['readFile', 'writeFile', 'glob', 'grep', 'find', 'CAS'],
  },

  /**
   * GitX - Git eXtended
   * Complete Git implementation for Workers
   */
  gitx: {
    package: 'gitx.do',
    capability: 'git',
    description: 'Complete Git implementation with packfile support',
    features: ['commit', 'merge', 'blame', 'branch', 'push', 'fetch'],
  },

  /**
   * BashX - Bash eXtended
   * AI-enhanced bash with safety analysis
   */
  bashx: {
    package: 'bashx.do',
    capability: 'bash',
    description: 'AI-enhanced bash with AST-based safety analysis',
    features: ['exec', 'parse', 'analyze', 'isDangerous', 'undo'],
  },

  /**
   * NpmX - NPM eXtended
   * NPM/NPX for edge runtimes
   */
  npmx: {
    package: 'npmx.do',
    capability: 'npm',
    description: 'NPM/NPX operations in Workers without Node.js',
    features: ['install', 'npx', 'info', 'search', 'semver'],
  },
} as const

/**
 * Type for the PRIMITIVES registry
 */
export type PrimitiveRegistry = typeof PRIMITIVES

/**
 * Names of all available primitives
 */
export type PrimitiveName = keyof PrimitiveRegistry

/**
 * Get primitive info by name
 */
export function getPrimitiveInfo(name: PrimitiveName) {
  return PRIMITIVES[name]
}

/**
 * List all available primitives
 */
export function listPrimitives(): PrimitiveName[] {
  return Object.keys(PRIMITIVES) as PrimitiveName[]
}
