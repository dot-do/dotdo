/**
 * Session Management Module
 *
 * Provides R2 Iceberg session persistence with fork/branch/experiment primitives.
 *
 * @module bashx/session
 */

// Re-export types
export * from './types.js'

// Re-export manager
export { CheckpointManager } from './checkpoint-manager.js'

// Re-export session class
export { Session } from './session.js'

// Factory functions
export {
  createSession,
  loadSession,
  sessionExists,
  listSessions,
  deleteSession,
  type SessionDependencies,
  type CreateSessionOptions,
} from './factory.js'

// GitxBranchStorage adapter for gitx integration
export {
  GitxBranchStorage,
  createGitxBranchStorage,
  createMockGitxAdapter,
  type GitxAdapter,
  type GitxBranchStorageOptions,
} from './gitx-branch-storage.js'
