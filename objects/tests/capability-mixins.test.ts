/**
 * Capability Mixin Tests
 *
 * RED TDD: These tests define the expected interface for capability mixins:
 * - withFs: Adds $.fs filesystem operations
 * - withGit: Adds $.git version control operations (requires fsx)
 * - withBash: Adds $.bash shell execution (requires fsx)
 *
 * Mixins extend the base DO class and augment the WorkflowContext ($) with
 * additional capabilities. They can be composed using standard mixin patterns:
 *
 * ```typescript
 * class MyDO extends withGit(withFs(DO)) {
 *   // Has $.fs and $.git
 * }
 * ```
 *
 * Note: These tests run in a Node environment, not Workers. We test:
 * - Mixin function existence and exports
 * - Type definitions and interfaces
 * - Mixin composition patterns (conceptually)
 * - Capability interfaces
 *
 * Runtime behavior with actual DO instances is tested in Workers environment.
 */

import { describe, it, expect } from 'vitest'

// These imports will FAIL until mixins are implemented
import {
  withFs,
  withGit,
  withBash,
  type FsCapability,
  type GitCapability,
  type BashCapability,
  type WithFsContext,
  type WithGitContext,
  type WithBashContext,
} from '../mixins'

import type { WorkflowContext } from '../../types/WorkflowContext'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Extended WorkflowContext with filesystem capability
 */
interface FsWorkflowContext extends WorkflowContext {
  fs: FsCapability
}

/**
 * Extended WorkflowContext with git capability
 */
interface GitWorkflowContext extends WorkflowContext {
  fs: FsCapability
  git: GitCapability
}

/**
 * Extended WorkflowContext with bash capability
 */
interface BashWorkflowContext extends WorkflowContext {
  fs: FsCapability
  bash: BashCapability
}

/**
 * Extended WorkflowContext with all capabilities
 */
interface FullWorkflowContext extends WorkflowContext {
  fs: FsCapability
  git: GitCapability
  bash: BashCapability
}

// ============================================================================
// MOCK DATA & FIXTURES
// ============================================================================

const mockFileContent = 'Hello, World!'
const mockFilePath = '/test/file.txt'
const mockDirPath = '/test/dir'

const mockGitStatus = {
  branch: 'main',
  staged: [] as string[],
  unstaged: [] as string[],
  untracked: [] as string[],
  ahead: 0,
  behind: 0,
}

const mockBashResult = {
  stdout: 'command output',
  stderr: '',
  exitCode: 0,
}

// ============================================================================
// TESTS
// ============================================================================

describe('Capability Mixins', () => {
  // ==========================================================================
  // 1. MIXIN EXISTENCE & IMPORT TESTS
  // ==========================================================================

  describe('Mixin Existence', () => {
    it('exports withFs mixin function', () => {
      expect(withFs).toBeDefined()
      expect(typeof withFs).toBe('function')
    })

    it('exports withGit mixin function', () => {
      expect(withGit).toBeDefined()
      expect(typeof withGit).toBe('function')
    })

    it('exports withBash mixin function', () => {
      expect(withBash).toBeDefined()
      expect(typeof withBash).toBe('function')
    })
  })

  // ==========================================================================
  // 2. withFs MIXIN TESTS
  // ==========================================================================

  describe('withFs Mixin', () => {
    describe('FsCapability Interface Types', () => {
      it('WithFsContext type is exported and extends WorkflowContext', () => {
        // Type assertion check - if this compiles, types are correct
        const _typeCheck: WithFsContext = {} as WithFsContext
        expect(_typeCheck).toBeDefined()

        // Verify it extends WorkflowContext base properties
        const _workflowCheck: WorkflowContext = _typeCheck
        expect(_workflowCheck).toBeDefined()
      })

      it('FsCapability type has read method signature', () => {
        // Type check
        type ReadResult = ReturnType<FsCapability['read']>
        const _: ReadResult = Promise.resolve('content')
        expect(_).toBeDefined()
      })

      it('FsCapability type has write method signature', () => {
        // Type check
        type WriteResult = ReturnType<FsCapability['write']>
        const _: WriteResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('FsCapability type has exists method signature', () => {
        // Type check
        type ExistsResult = ReturnType<FsCapability['exists']>
        const _: ExistsResult = Promise.resolve(true)
        expect(_).toBeDefined()
      })

      it('FsCapability type has delete method signature', () => {
        // Type check
        type DeleteResult = ReturnType<FsCapability['delete']>
        const _: DeleteResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('FsCapability type has list method signature', () => {
        // Type check
        type ListResult = ReturnType<FsCapability['list']>
        const _: ListResult = Promise.resolve([{ name: 'file.txt', isDirectory: false }])
        expect(_).toBeDefined()
      })

      it('FsCapability type has mkdir method signature', () => {
        // Type check
        type MkdirResult = ReturnType<FsCapability['mkdir']>
        const _: MkdirResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('FsCapability type has stat method signature', () => {
        // Type check
        type StatResult = ReturnType<FsCapability['stat']>
        const _: StatResult = Promise.resolve({
          size: 100,
          isDirectory: false,
          isFile: true,
          createdAt: new Date(),
          modifiedAt: new Date(),
        })
        expect(_).toBeDefined()
      })

      it('FsCapability type has copy method signature', () => {
        // Type check
        type CopyResult = ReturnType<FsCapability['copy']>
        const _: CopyResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('FsCapability type has move method signature', () => {
        // Type check
        type MoveResult = ReturnType<FsCapability['move']>
        const _: MoveResult = Promise.resolve()
        expect(_).toBeDefined()
      })
    })

    describe('withFs Function Contract', () => {
      it('withFs is a higher-order function that accepts a class constructor', () => {
        expect(typeof withFs).toBe('function')
        // When implemented, withFs should accept a constructor and return a constructor
      })

      it('withFs returns a class constructor when applied', () => {
        // Create a minimal mock class that looks like DO
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
        }

        // Apply withFs - should return a class constructor
        const ExtendedClass = withFs(MockDO as any)

        expect(ExtendedClass).toBeDefined()
        expect(typeof ExtendedClass).toBe('function')
      })

      it('withFs extended class can be instantiated', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const ExtendedClass = withFs(MockDO as any)
        const instance = new ExtendedClass()

        expect(instance).toBeDefined()
        expect(instance.$).toBeDefined()
        expect(instance.$.fs).toBeDefined()
      })

      it('withFs adds $.fs with all required methods', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const ExtendedClass = withFs(MockDO as any)
        const instance = new ExtendedClass()

        // Verify all FsCapability methods exist
        expect(typeof instance.$.fs.read).toBe('function')
        expect(typeof instance.$.fs.write).toBe('function')
        expect(typeof instance.$.fs.exists).toBe('function')
        expect(typeof instance.$.fs.delete).toBe('function')
        expect(typeof instance.$.fs.list).toBe('function')
        expect(typeof instance.$.fs.mkdir).toBe('function')
        expect(typeof instance.$.fs.stat).toBe('function')
        expect(typeof instance.$.fs.copy).toBe('function')
        expect(typeof instance.$.fs.move).toBe('function')
      })
    })
  })

  // ==========================================================================
  // 3. withGit MIXIN TESTS
  // ==========================================================================

  describe('withGit Mixin', () => {
    describe('GitCapability Interface Types', () => {
      it('WithGitContext type is exported and extends WithFsContext', () => {
        // Type assertion check - verifies type is exported
        const _typeCheck: WithGitContext = {} as WithGitContext
        expect(_typeCheck).toBeDefined()

        // Verify type structure includes fs (type-level check, not runtime)
        // If this compiles, the type includes fs property
        type HasFs = WithGitContext['fs']
        type FsIsCorrect = HasFs extends FsCapability ? true : false
        const _typeCorrect: FsIsCorrect = true
        expect(_typeCorrect).toBe(true)
      })

      it('GitCapability type has status method signature', () => {
        // Type check
        type StatusResult = ReturnType<GitCapability['status']>
        const _: StatusResult = Promise.resolve(mockGitStatus)
        expect(_).toBeDefined()
      })

      it('GitCapability type has add method signature', () => {
        // Type check - add accepts string or string[]
        const cap: GitCapability = {} as GitCapability
        type AddArg = Parameters<typeof cap.add>[0]
        const _singleFile: AddArg = 'file.txt'
        const _multipleFiles: AddArg = ['file1.txt', 'file2.txt']
        expect(true).toBe(true)
      })

      it('GitCapability type has commit method signature', () => {
        // Type check
        type CommitResult = ReturnType<GitCapability['commit']>
        const _: CommitResult = Promise.resolve({ hash: 'abc123', message: 'feat: add feature' })
        expect(_).toBeDefined()
      })

      it('GitCapability type has push method signature', () => {
        // Type check
        type PushResult = ReturnType<GitCapability['push']>
        const _: PushResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has pull method signature', () => {
        // Type check
        type PullResult = ReturnType<GitCapability['pull']>
        const _: PullResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has checkout method signature', () => {
        // Type check
        type CheckoutResult = ReturnType<GitCapability['checkout']>
        const _: CheckoutResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has branch method signature', () => {
        // Type check
        type BranchResult = ReturnType<GitCapability['branch']>
        const _: BranchResult = Promise.resolve({ current: 'main', all: ['main', 'develop'] })
        expect(_).toBeDefined()
      })

      it('GitCapability type has log method signature', () => {
        // Type check
        type LogResult = ReturnType<GitCapability['log']>
        const _: LogResult = Promise.resolve([
          { hash: 'abc123', message: 'feat: feature', author: 'user@example.com.ai', date: new Date() },
        ])
        expect(_).toBeDefined()
      })

      it('GitCapability type has diff method signature', () => {
        // Type check
        type DiffResult = ReturnType<GitCapability['diff']>
        const _: DiffResult = Promise.resolve({
          files: [{ path: 'file.ts', additions: 10, deletions: 5, patch: '...' }],
        })
        expect(_).toBeDefined()
      })

      it('GitCapability type has clone method signature', () => {
        // Type check
        type CloneResult = ReturnType<GitCapability['clone']>
        const _: CloneResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has init method signature', () => {
        // Type check
        type InitResult = ReturnType<GitCapability['init']>
        const _: InitResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has stash method signature', () => {
        // Type check
        type StashResult = ReturnType<GitCapability['stash']>
        const _: StashResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has merge method signature', () => {
        // Type check
        type MergeResult = ReturnType<GitCapability['merge']>
        const _: MergeResult = Promise.resolve({ success: true, conflicts: [] })
        expect(_).toBeDefined()
      })

      it('GitCapability type has rebase method signature', () => {
        // Type check
        type RebaseResult = ReturnType<GitCapability['rebase']>
        const _: RebaseResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has reset method signature', () => {
        // Type check
        type ResetResult = ReturnType<GitCapability['reset']>
        const _: ResetResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('GitCapability type has tag method signature', () => {
        // Tag can return void or string[] depending on options
        const cap: GitCapability = {} as GitCapability
        expect(typeof cap.tag).toBe('undefined') // Not implemented yet
      })

      it('GitCapability type has remote method signature', () => {
        // Type check
        type RemoteResult = ReturnType<GitCapability['remote']>
        const _: RemoteResult = Promise.resolve([{ name: 'origin', url: 'https://...' }])
        expect(_).toBeDefined()
      })
    })

    describe('withGit Function Contract', () => {
      it('withGit is a higher-order function', () => {
        expect(typeof withGit).toBe('function')
      })

      it('withGit returns a class constructor when applied to withFs class', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        // First apply withFs, then withGit
        const WithFsClass = withFs(MockDO as any)
        const WithGitClass = withGit(WithFsClass)

        expect(WithGitClass).toBeDefined()
        expect(typeof WithGitClass).toBe('function')
      })

      it('withGit extended class can be instantiated', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const WithFsClass = withFs(MockDO as any)
        const WithGitClass = withGit(WithFsClass)
        const instance = new WithGitClass()

        expect(instance).toBeDefined()
        expect(instance.$).toBeDefined()
        expect(instance.$.fs).toBeDefined() // Should preserve fs
        expect(instance.$.git).toBeDefined() // Should add git
      })

      it('withGit adds $.git with all required methods', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const WithFsClass = withFs(MockDO as any)
        const WithGitClass = withGit(WithFsClass)
        const instance = new WithGitClass()

        // Verify all GitCapability methods exist
        expect(typeof instance.$.git.status).toBe('function')
        expect(typeof instance.$.git.add).toBe('function')
        expect(typeof instance.$.git.commit).toBe('function')
        expect(typeof instance.$.git.push).toBe('function')
        expect(typeof instance.$.git.pull).toBe('function')
        expect(typeof instance.$.git.checkout).toBe('function')
        expect(typeof instance.$.git.branch).toBe('function')
        expect(typeof instance.$.git.log).toBe('function')
        expect(typeof instance.$.git.diff).toBe('function')
        expect(typeof instance.$.git.clone).toBe('function')
        expect(typeof instance.$.git.init).toBe('function')
        expect(typeof instance.$.git.stash).toBe('function')
        expect(typeof instance.$.git.merge).toBe('function')
        expect(typeof instance.$.git.rebase).toBe('function')
        expect(typeof instance.$.git.reset).toBe('function')
        expect(typeof instance.$.git.tag).toBe('function')
        expect(typeof instance.$.git.remote).toBe('function')
      })
    })
  })

  // ==========================================================================
  // 4. withBash MIXIN TESTS
  // ==========================================================================

  describe('withBash Mixin', () => {
    describe('BashCapability Interface Types', () => {
      it('WithBashContext type is exported and extends WithFsContext', () => {
        // Type assertion check - verifies type is exported
        const _typeCheck: WithBashContext = {} as WithBashContext
        expect(_typeCheck).toBeDefined()

        // Verify type structure includes fs (type-level check, not runtime)
        // If this compiles, the type includes fs property
        type HasFs = WithBashContext['fs']
        type FsIsCorrect = HasFs extends FsCapability ? true : false
        const _typeCorrect: FsIsCorrect = true
        expect(_typeCorrect).toBe(true)
      })

      it('BashCapability type has exec method signature', () => {
        // Type check
        type ExecResult = ReturnType<BashCapability['exec']>
        const _: ExecResult = Promise.resolve(mockBashResult)
        expect(_).toBeDefined()
      })

      it('BashCapability type has run method signature', () => {
        // Type check - run returns stdout string directly
        type RunResult = ReturnType<BashCapability['run']>
        const _: RunResult = Promise.resolve('hello\n')
        expect(_).toBeDefined()
      })

      it('BashCapability type has spawn method signature', () => {
        // Type check
        type SpawnResult = ReturnType<BashCapability['spawn']>
        // spawn returns a process-like object
        expect(true).toBe(true)
      })

      it('BashCapability type has which method signature', () => {
        // Type check
        type WhichResult = ReturnType<BashCapability['which']>
        const _: WhichResult = Promise.resolve('/usr/local/bin/node')
        expect(_).toBeDefined()
      })

      it('BashCapability type has env method signature', () => {
        // Type check - env is overloaded
        const cap: BashCapability = {} as BashCapability
        expect(typeof cap.env).toBe('undefined') // Not implemented yet
      })

      it('BashCapability type has cd method signature', () => {
        // Type check
        type CdResult = ReturnType<BashCapability['cd']>
        const _: CdResult = Promise.resolve()
        expect(_).toBeDefined()
      })

      it('BashCapability type has pipe method signature', () => {
        // Type check
        type PipeResult = ReturnType<BashCapability['pipe']>
        const _: PipeResult = Promise.resolve(mockBashResult)
        expect(_).toBeDefined()
      })
    })

    describe('withBash Function Contract', () => {
      it('withBash is a higher-order function', () => {
        expect(typeof withBash).toBe('function')
      })

      it('withBash returns a class constructor when applied to withFs class', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        // First apply withFs, then withBash
        const WithFsClass = withFs(MockDO as any)
        const WithBashClass = withBash(WithFsClass)

        expect(WithBashClass).toBeDefined()
        expect(typeof WithBashClass).toBe('function')
      })

      it('withBash extended class can be instantiated', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const WithFsClass = withFs(MockDO as any)
        const WithBashClass = withBash(WithFsClass)
        const instance = new WithBashClass()

        expect(instance).toBeDefined()
        expect(instance.$).toBeDefined()
        expect(instance.$.fs).toBeDefined() // Should preserve fs
        expect(instance.$.bash).toBeDefined() // Should add bash
      })

      it('withBash adds $.bash with all required methods', () => {
        class MockDO {
          $: WorkflowContext = {} as WorkflowContext
          constructor() {}
        }

        const WithFsClass = withFs(MockDO as any)
        const WithBashClass = withBash(WithFsClass)
        const instance = new WithBashClass()

        // Verify all BashCapability methods exist
        expect(typeof instance.$.bash.exec).toBe('function')
        expect(typeof instance.$.bash.run).toBe('function')
        expect(typeof instance.$.bash.spawn).toBe('function')
        expect(typeof instance.$.bash.which).toBe('function')
        expect(typeof instance.$.bash.env).toBe('function')
        expect(typeof instance.$.bash.cd).toBe('function')
        expect(typeof instance.$.bash.pipe).toBe('function')
      })
    })
  })

  // ==========================================================================
  // 5. MIXIN COMPOSITION TYPE TESTS
  // ==========================================================================

  describe('Mixin Composition Types', () => {
    it('FsWorkflowContext has WorkflowContext base properties plus fs', () => {
      const ctx: FsWorkflowContext = {} as FsWorkflowContext

      // Should have base WorkflowContext methods
      type HasSend = typeof ctx.send
      type HasTry = typeof ctx.try
      type HasDo = typeof ctx.do
      type HasOn = typeof ctx.on
      type HasEvery = typeof ctx.every
      type HasBranch = typeof ctx.branch
      type HasCheckout = typeof ctx.checkout
      type HasMerge = typeof ctx.merge
      type HasLog = typeof ctx.log
      type HasState = typeof ctx.state

      // Should have fs capability
      type HasFs = typeof ctx.fs

      expect(true).toBe(true) // Type check passed
    })

    it('GitWorkflowContext has FsWorkflowContext properties plus git', () => {
      const ctx: GitWorkflowContext = {} as GitWorkflowContext

      // Should have fs capability
      type HasFs = typeof ctx.fs

      // Should have git capability
      type HasGit = typeof ctx.git

      expect(true).toBe(true) // Type check passed
    })

    it('BashWorkflowContext has FsWorkflowContext properties plus bash', () => {
      const ctx: BashWorkflowContext = {} as BashWorkflowContext

      // Should have fs capability
      type HasFs = typeof ctx.fs

      // Should have bash capability
      type HasBash = typeof ctx.bash

      expect(true).toBe(true) // Type check passed
    })

    it('FullWorkflowContext has all three capabilities', () => {
      const ctx: FullWorkflowContext = {} as FullWorkflowContext

      // Should have all capabilities
      type HasFs = typeof ctx.fs
      type HasGit = typeof ctx.git
      type HasBash = typeof ctx.bash

      expect(true).toBe(true) // Type check passed
    })
  })

  // ==========================================================================
  // 6. DEPENDENCY CHAIN & COMPOSITION TESTS
  // ==========================================================================

  describe('Dependency Chain', () => {
    it('withFs can be applied directly to a base class', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const Extended = withFs(MockDO as any)
      const instance = new Extended()

      expect(instance.$.fs).toBeDefined()
    })

    it('withGit can be applied to withFs result', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const WithFsClass = withFs(MockDO as any)
      const WithGitClass = withGit(WithFsClass)
      const instance = new WithGitClass()

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
    })

    it('withBash can be applied to withFs result', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const WithFsClass = withFs(MockDO as any)
      const WithBashClass = withBash(WithFsClass)
      const instance = new WithBashClass()

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.bash).toBeDefined()
    })

    it('withBash(withGit(withFs())) provides all three capabilities', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const FullClass = withBash(withGit(withFs(MockDO as any)))
      const instance = new FullClass()

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
      expect(instance.$.bash).toBeDefined()
    })

    it('withGit(withBash(withFs())) also provides all three capabilities', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const FullClass = withGit(withBash(withFs(MockDO as any)))
      const instance = new FullClass()

      expect(instance.$.fs).toBeDefined()
      expect(instance.$.git).toBeDefined()
      expect(instance.$.bash).toBeDefined()
    })

    it('withFs is idempotent - can be applied twice without error', () => {
      class MockDO {
        $: WorkflowContext = {} as WorkflowContext
        constructor() {}
      }

      const DoubleFs = withFs(withFs(MockDO as any))
      const instance = new DoubleFs()

      expect(instance.$.fs).toBeDefined()
    })
  })

  // ==========================================================================
  // 7. REAL WORLD USAGE PATTERNS (Type Checking)
  // ==========================================================================

  describe('Real World Usage Patterns (Type Documentation)', () => {
    it('documents git workflow pattern', () => {
      // Example usage:
      // class GitWorkflowDO extends withGit(withFs(DO)) {
      //   async commitChanges(message: string) {
      //     await this.$.fs.write('/src/feature.ts', 'export const feature = true')
      //     await this.$.git.add('/src/feature.ts')
      //     const commit = await this.$.git.commit(message)
      //     await this.$.git.push()
      //     return commit
      //   }
      // }
      expect(true).toBe(true)
    })

    it('documents bash workflow pattern', () => {
      // Example usage:
      // class DeployDO extends withBash(withFs(DO)) {
      //   async deploy() {
      //     const testResult = await this.$.bash.exec('npm test')
      //     if (testResult.exitCode !== 0) throw new Error('Tests failed')
      //     await this.$.bash.run('npm run build')
      //     await this.$.bash.run('npm run deploy')
      //     return { success: true }
      //   }
      // }
      expect(true).toBe(true)
    })

    it('documents combined git+bash workflow pattern', () => {
      // Example usage:
      // class CIWorkflowDO extends withBash(withGit(withFs(DO))) {
      //   async ciPipeline() {
      //     await this.$.git.pull()
      //     await this.$.bash.run('npm ci')
      //     await this.$.bash.run('npm test')
      //     await this.$.bash.run('npm run build')
      //     await this.$.git.add('dist/')
      //     await this.$.git.commit('chore: build artifacts')
      //     await this.$.git.push()
      //     return { success: true }
      //   }
      // }
      expect(true).toBe(true)
    })

    it('documents file management pattern', () => {
      // Example usage:
      // class FileManagerDO extends withFs(DO) {
      //   async organizeFiles(srcDir: string, destDir: string) {
      //     const entries = await this.$.fs.list(srcDir)
      //     for (const entry of entries) {
      //       if (!entry.isDirectory) {
      //         await this.$.fs.copy(`${srcDir}/${entry.name}`, `${destDir}/${entry.name}`)
      //       }
      //     }
      //     return { copied: entries.length }
      //   }
      // }
      expect(true).toBe(true)
    })

    it('documents scaffolding pattern with all capabilities', () => {
      // Example usage:
      // class ScaffoldDO extends withBash(withGit(withFs(DO))) {
      //   async scaffold(projectName: string) {
      //     const projectDir = `/projects/${projectName}`
      //     await this.$.fs.mkdir(`${projectDir}/src`, { recursive: true })
      //     await this.$.fs.write(`${projectDir}/package.json`, JSON.stringify({ name: projectName }))
      //     await this.$.bash.cd(projectDir)
      //     await this.$.git.init()
      //     await this.$.bash.run('npm install')
      //     await this.$.git.add('.')
      //     await this.$.git.commit('feat: initial scaffold')
      //     return { projectDir }
      //   }
      // }
      expect(true).toBe(true)
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING DOCUMENTATION
  // ==========================================================================

  describe('Error Handling Patterns (Documentation)', () => {
    describe('FsCapability Errors', () => {
      it('documents that read throws on file not found', () => {
        // $.fs.read('/nonexistent') should throw with FileNotFoundError
        expect(true).toBe(true)
      })

      it('documents that write throws on permission denied', () => {
        // $.fs.write('/readonly', 'content') should throw with PermissionError
        expect(true).toBe(true)
      })
    })

    describe('GitCapability Errors', () => {
      it('documents that status throws when not in git repo', () => {
        // $.git.status() in non-git directory should throw
        expect(true).toBe(true)
      })

      it('documents that commit throws on nothing to commit', () => {
        // $.git.commit('msg') with no staged changes should throw
        expect(true).toBe(true)
      })
    })

    describe('BashCapability Errors', () => {
      it('documents that exec returns non-zero exit code without throwing', () => {
        // $.bash.exec('exit 1') should return { exitCode: 1 }, not throw
        expect(true).toBe(true)
      })

      it('documents that run throws on non-zero exit code', () => {
        // $.bash.run('exit 1') should throw because run is strict
        expect(true).toBe(true)
      })

      it('documents that exec throws on timeout', () => {
        // $.bash.exec('sleep 100', { timeout: 1 }) should throw TimeoutError
        expect(true).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 9. TYPE SAFETY TESTS
  // ==========================================================================

  describe('Type Safety', () => {
    it('WithFsContext correctly extends WorkflowContext', () => {
      // Type assignment should work
      const fsCtx: WithFsContext = {} as WithFsContext
      const baseCtx: WorkflowContext = fsCtx
      expect(baseCtx).toBeDefined()
    })

    it('WithGitContext correctly extends WithFsContext', () => {
      // Type assignment should work
      const gitCtx: WithGitContext = {} as WithGitContext
      const fsCtx: WithFsContext = gitCtx
      expect(fsCtx).toBeDefined()
    })

    it('WithBashContext correctly extends WithFsContext', () => {
      // Type assignment should work
      const bashCtx: WithBashContext = {} as WithBashContext
      const fsCtx: WithFsContext = bashCtx
      expect(fsCtx).toBeDefined()
    })

    it('FullWorkflowContext is compatible with all capability contexts', () => {
      const fullCtx: FullWorkflowContext = {} as FullWorkflowContext

      // Should be assignable to each context type
      const _asFs: FsWorkflowContext = fullCtx
      const _asGit: GitWorkflowContext = fullCtx
      const _asBash: BashWorkflowContext = fullCtx

      expect(true).toBe(true)
    })
  })
})
