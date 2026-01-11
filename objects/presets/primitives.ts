/**
 * DOWithPrimitives Preset
 *
 * A pre-composed Durable Object class that includes all extended primitives:
 * - $.fs: Filesystem operations (SQLite-backed, R2 tiered)
 * - $.git: Git version control (R2-backed object store)
 * - $.bash: Shell execution (safe sandbox)
 * - $.npm: Package management (registry resolution)
 *
 * This preset is ideal for:
 * - Developer tools that need filesystem + git + shell
 * - Build systems and CI/CD pipelines
 * - Code generation and deployment workflows
 * - Any DO that needs the "full" development environment
 *
 * @example
 * ```typescript
 * import { DOWithPrimitives } from 'dotdo/presets'
 *
 * class MyDevToolDO extends DOWithPrimitives {
 *   static readonly $type = 'MyDevToolDO'
 *
 *   async buildProject() {
 *     // Write source files
 *     await this.$.fs.write('/src/index.ts', sourceCode)
 *
 *     // Install dependencies
 *     await this.$.npm.install(['typescript', 'esbuild'])
 *
 *     // Build with shell
 *     await this.$.bash.exec('npx', ['esbuild', 'src/index.ts', '--bundle'])
 *
 *     // Commit the result
 *     await this.$.git.add('.')
 *     await this.$.git.commit('Build output')
 *   }
 * }
 * ```
 *
 * @module objects/presets/primitives
 */

import { DO, type Env } from '../DO'
import { withFs, type FsCapability, type WithFsContext } from '../../lib/mixins/fs'
import { withGit, type GitCapability, type WithGitContext } from '../../lib/mixins/git'
import {
  withBash,
  type BashCapability,
  type WithBashContext,
  type BashExecutor,
  type BashResult,
  type ExecOptions,
} from '../../lib/mixins/bash'
import { withNpm, type NpmCapability, type WithNpmContext } from '../../lib/mixins/npm'
import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// DEFAULT BASH EXECUTOR
// ============================================================================

/**
 * Default bash executor for DOWithPrimitives.
 *
 * This executor handles commands safely within the DO environment:
 * - Native fs operations (cat, ls, etc.) are handled by $.fs
 * - Other commands return a "not available" error unless a real executor is provided
 *
 * In production, you can override this by configuring a proper executor
 * (e.g., connected to bashx worker or external process).
 */
const defaultBashExecutor: BashExecutor = {
  async execute(command: string, _options?: ExecOptions): Promise<BashResult> {
    // Default executor handles native fs commands via $.fs (done by withBash)
    // For other commands, we return an error indicating no external executor
    return {
      input: command,
      command: command,
      valid: true,
      generated: false,
      exitCode: 127,
      stdout: '',
      stderr: `bash: command execution not available in default mode. Command: ${command}`,
      intent: {
        commands: [command],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Default executor - no real execution',
      },
    }
  },
}

// ============================================================================
// COMPOSITE CONTEXT TYPE
// ============================================================================

/**
 * Combined workflow context type with all primitives.
 * Extends the base WorkflowContext with fs, git, bash, and npm capabilities.
 */
export interface PrimitivesContext extends WorkflowContext {
  /**
   * Filesystem operations
   */
  fs: FsCapability

  /**
   * Git version control operations
   */
  git: GitCapability

  /**
   * Shell execution
   */
  bash: BashCapability

  /**
   * NPM package management
   */
  npm: NpmCapability
}

// ============================================================================
// MIXIN COMPOSITION
// ============================================================================

/**
 * Base with filesystem
 */
const WithFsBase = withFs(DO)

/**
 * Add git on top of fs
 */
const WithGitBase = withGit(WithFsBase)

/**
 * Add bash with default executor that uses $.fs for native operations
 */
const WithBashBase = withBash(WithGitBase, {
  executor: () => defaultBashExecutor,
  fs: (instance) => (instance as any).$.fs,
  useNativeOps: true,
  requireFs: false,
})

/**
 * Add npm on top (uses $.fs and $.bash automatically from $)
 */
const ComposedBase = withNpm(WithBashBase)

// ============================================================================
// PRESET CLASS
// ============================================================================

/**
 * DOWithPrimitives - Pre-composed DO with all extended primitives.
 *
 * Provides a complete development environment inside a Durable Object:
 * - $.fs: Read/write files, directories, with R2 tiering
 * - $.git: Version control with commit, push, sync
 * - $.bash: Safe shell execution with command analysis
 * - $.npm: Package resolution, installation, script running
 *
 * @example Basic usage
 * ```typescript
 * import { DOWithPrimitives } from 'dotdo/presets'
 *
 * export class MyDO extends DOWithPrimitives {
 *   static readonly $type = 'MyDO'
 *
 *   async processFiles() {
 *     const files = await this.$.fs.list('/')
 *     for (const file of files) {
 *       console.log(file.name)
 *     }
 *   }
 * }
 * ```
 *
 * @example Full development workflow
 * ```typescript
 * async deployApp() {
 *   // Configure git
 *   this.$.git.configure({
 *     repo: 'myorg/myapp',
 *     branch: 'main'
 *   })
 *
 *   // Sync from remote
 *   await this.$.git.sync()
 *
 *   // Install and build
 *   await this.$.npm.install()
 *   await this.$.bash.exec('npm', ['run', 'build'])
 *
 *   // Commit build output
 *   await this.$.git.add('dist/')
 *   await this.$.git.commit('chore: build')
 *   await this.$.git.push()
 * }
 * ```
 */
export class DOWithPrimitives extends ComposedBase {
  /**
   * Static type identifier for this preset.
   */
  static readonly $type = 'DOWithPrimitives'

  /**
   * Static list of capabilities provided by this preset.
   * Cast to any[] for compatibility with mixin static capabilities type.
   */
  static override capabilities = ['fs', 'git', 'bash', 'npm'] as string[]

  /**
   * Get the primitives context with proper typing.
   * The actual capabilities are injected by the mixins.
   * Uses a type assertion since mixins set $ as a class field.
   */
  getPrimitivesContext(): PrimitivesContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).$ as PrimitivesContext
  }
}

/**
 * Alias for DOWithPrimitives for users who prefer the longer name.
 */
export const DOWithAllPrimitives = DOWithPrimitives

/**
 * Type helper for classes extending DOWithPrimitives.
 */
export type DOWithPrimitivesInstance = InstanceType<typeof DOWithPrimitives>

/**
 * Type helper for the $ context in DOWithPrimitives.
 */
export type DOWithPrimitivesContext = PrimitivesContext
