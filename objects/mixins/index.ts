/**
 * Capabilities for Durable Objects
 *
 * This module exports all capabilities that can be composed
 * with Durable Object classes to add optional features.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withFs, withGit, withBash } from 'dotdo/mixins'
 *
 * // Compose capabilities
 * class MyDO extends withBash(withGit(withFs(DO))) {
 *   async handleRequest(req: Request) {
 *     // Access all capabilities via $
 *     await this.$.fs.write('/file.txt', 'Hello')
 *     await this.$.git.commit('Add file')
 *     await this.$.bash.exec('echo "Done"')
 *   }
 * }
 * ```
 */

// Infrastructure for creating custom capabilities
export {
  createCapability,
  type Constructor,
  type CapabilityContext,
  type CapabilityInit,
  type CapabilityMixin,
} from './infrastructure'

// Filesystem capability
export {
  withFs,
  type WithFsOptions,
  type WithFsContext,
  type FsCapability,
  FsModule,
} from './fs'

// NPM package management capability
export {
  withNpm,
  type WithNpmOptions,
  type WithNpmContext,
  type NpmCapability,
  type BashResult,
  type LockFile,
  type LockFileEntry,
  type InstallResult,
  type InstalledPackage,
  type PackageJson,
  type ResolvedPackage,
} from './npm'

// Primitives capability (TemporalStore, WindowManager, ExactlyOnceContext)
export {
  withPrimitives,
  type PrimitivesCapability,
  type WithPrimitivesContext,
  type PrimitivesDO,
  type DOPrimitiveFactory,
  type DurationSpec,
  type WindowType,
  type WindowConfig,
  // Re-export primitive types
  type TemporalStore,
  type TemporalStoreOptions,
  type ExactlyOnceContextInterface,
  type ExactlyOnceContextOptions,
  type TypedColumnStore,
  // Re-export utilities
  hours,
  minutes,
  seconds,
  milliseconds,
  WindowManager,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Trigger,
} from '../primitives/with-primitives'
