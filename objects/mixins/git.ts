/**
 * withGit Mixin - Git Version Control Capability
 *
 * Adds $.git to the WorkflowContext with git operations:
 * - status, add, commit, push, pull
 * - checkout, branch, log, diff
 * - clone, init, stash, merge, rebase
 * - reset, tag, remote
 *
 * Requires: withFs (depends on filesystem access)
 *
 * This is a stub file - implementation pending.
 * Tests are written to drive implementation (RED TDD).
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../DO'
import type { FsCapability, WithFsContext } from './fs'

// ============================================================================
// CAPABILITY TYPES
// ============================================================================

export interface GitStatus {
  branch: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  ahead: number
  behind: number
}

export interface GitCommitResult {
  hash: string
  message: string
}

export interface GitBranchResult {
  current: string
  all: string[]
}

export interface GitLogEntry {
  hash: string
  message: string
  author: string
  date: Date
}

export interface GitDiffFile {
  path: string
  additions: number
  deletions: number
  patch: string
}

export interface GitDiffResult {
  files: GitDiffFile[]
}

export interface GitMergeResult {
  success: boolean
  conflicts: string[]
}

export interface GitRemote {
  name: string
  url: string
}

export interface GitPushOptions {
  remote?: string
  branch?: string
  force?: boolean
}

export interface GitPullOptions {
  remote?: string
  branch?: string
  rebase?: boolean
}

export interface GitCheckoutOptions {
  create?: boolean
}

export interface GitBranchOptions {
  create?: boolean
  delete?: boolean
}

export interface GitLogOptions {
  limit?: number
}

export interface GitDiffOptions {
  staged?: boolean
  files?: string[]
}

export interface GitCloneOptions {
  depth?: number
}

export interface GitInitOptions {
  bare?: boolean
}

export interface GitStashOptions {
  message?: string
  action?: 'push' | 'pop' | 'list' | 'drop'
}

export interface GitMergeOptions {
  noFf?: boolean
}

export interface GitRebaseOptions {
  interactive?: boolean
}

export interface GitResetOptions {
  mode?: 'soft' | 'mixed' | 'hard'
}

export interface GitTagOptions {
  message?: string
  list?: boolean
}

export interface GitRemoteOptions {
  add?: { name: string; url: string }
  remove?: string
}

export interface GitCapability {
  status(): Promise<GitStatus>
  add(pathOrPaths: string | string[]): Promise<void>
  commit(message: string): Promise<GitCommitResult>
  push(options?: GitPushOptions): Promise<void>
  pull(options?: GitPullOptions): Promise<void>
  checkout(ref: string, options?: GitCheckoutOptions): Promise<void>
  branch(nameOrOptions?: string | GitBranchOptions, options?: GitBranchOptions): Promise<GitBranchResult>
  log(options?: GitLogOptions): Promise<GitLogEntry[]>
  diff(options?: GitDiffOptions): Promise<GitDiffResult>
  clone(url: string, dest?: string, options?: GitCloneOptions): Promise<void>
  init(path?: string, options?: GitInitOptions): Promise<void>
  stash(options?: GitStashOptions): Promise<void>
  merge(branch: string, options?: GitMergeOptions): Promise<GitMergeResult>
  rebase(branch: string, options?: GitRebaseOptions): Promise<void>
  reset(ref: string, options?: GitResetOptions): Promise<void>
  tag(name: string, options?: GitTagOptions): Promise<string[] | void>
  remote(options?: GitRemoteOptions): Promise<GitRemote[]>
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithGitContext extends WithFsContext {
  git: GitCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

type Constructor<T = {}> = new (...args: unknown[]) => T

// Type that requires $.fs to exist on the base class
type DOWithFsConstructor<E extends Env = Env> = Constructor<DO<E> & { $: WithFsContext }> & typeof DO<E>

export interface WithGitDO<E extends Env = Env> extends DO<E> {
  $: WithGitContext
}

// ============================================================================
// CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * Creates a GitCapability instance
 * This is a stub implementation - actual git operations would be
 * implemented using either shell commands or a git library
 */
function createGitCapability(): GitCapability {
  return {
    async status(): Promise<GitStatus> {
      // Stub implementation
      throw new Error('git.status not implemented')
    },
    async add(pathOrPaths: string | string[]): Promise<void> {
      // Stub implementation
      throw new Error('git.add not implemented')
    },
    async commit(message: string): Promise<GitCommitResult> {
      // Stub implementation
      throw new Error('git.commit not implemented')
    },
    async push(options?: GitPushOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.push not implemented')
    },
    async pull(options?: GitPullOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.pull not implemented')
    },
    async checkout(ref: string, options?: GitCheckoutOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.checkout not implemented')
    },
    async branch(nameOrOptions?: string | GitBranchOptions, options?: GitBranchOptions): Promise<GitBranchResult> {
      // Stub implementation
      throw new Error('git.branch not implemented')
    },
    async log(options?: GitLogOptions): Promise<GitLogEntry[]> {
      // Stub implementation
      throw new Error('git.log not implemented')
    },
    async diff(options?: GitDiffOptions): Promise<GitDiffResult> {
      // Stub implementation
      throw new Error('git.diff not implemented')
    },
    async clone(url: string, dest?: string, options?: GitCloneOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.clone not implemented')
    },
    async init(path?: string, options?: GitInitOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.init not implemented')
    },
    async stash(options?: GitStashOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.stash not implemented')
    },
    async merge(branch: string, options?: GitMergeOptions): Promise<GitMergeResult> {
      // Stub implementation
      throw new Error('git.merge not implemented')
    },
    async rebase(branch: string, options?: GitRebaseOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.rebase not implemented')
    },
    async reset(ref: string, options?: GitResetOptions): Promise<void> {
      // Stub implementation
      throw new Error('git.reset not implemented')
    },
    async tag(name: string, options?: GitTagOptions): Promise<string[] | void> {
      // Stub implementation
      throw new Error('git.tag not implemented')
    },
    async remote(options?: GitRemoteOptions): Promise<GitRemote[]> {
      // Stub implementation
      throw new Error('git.remote not implemented')
    },
  }
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the git capability instance
const GIT_CAPABILITY_CACHE = Symbol('gitCapabilityCache')

/**
 * Adds git capability to a DO class that already has filesystem capability
 *
 * @example
 * ```typescript
 * class MyDO extends withGit(withFs(DO)) {
 *   async commitChanges() {
 *     await this.$.git.add('.')
 *     await this.$.git.commit('feat: add feature')
 *     await this.$.git.push()
 *   }
 * }
 * ```
 */
export function withGit<TBase extends Constructor<{ $: WithFsContext }>>(Base: TBase) {
  return class WithGit extends Base {
    static capabilities = [...((Base as any).capabilities || []), 'git']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'git') return true
      // Check if parent class has the hasCapability method (WithFs class)
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the git capability instance
    private [GIT_CAPABILITY_CACHE]?: GitCapability

    /**
     * Lazy-loaded git capability
     */
    private get gitCapability(): GitCapability {
      if (!this[GIT_CAPABILITY_CACHE]) {
        this[GIT_CAPABILITY_CACHE] = createGitCapability()
      }
      return this[GIT_CAPABILITY_CACHE]
    }

    constructor(...args: ConstructorParameters<TBase>) {
      super(...args)

      // Extend $ to include git capability (preserving fs from parent)
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with git
      this.$ = new Proxy(originalContext as WithGitContext, {
        get(target, prop: string | symbol) {
          if (prop === 'git') {
            return self.gitCapability
          }
          // Forward to original context (which includes fs)
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
      })
    }
  }
}
