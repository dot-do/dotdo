/**
 * @dotdo/do/primitives - Extended Primitives with AI Assistance
 *
 * This module provides extended primitives that integrate with the WorkflowContext ($)
 * pattern and can leverage AI for intelligent operations.
 *
 * Available primitives:
 * - fsx: File system operations with AI assistance
 * - gitx: Git operations with AI assistance
 * - bashx: Bash/shell command execution with AI assistance
 *
 * @packageDocumentation
 */

// File System Extended Primitive
export {
  FSX,
  createFSX,
  fsx,
  type FileInfo,
  type ReadOptions,
  type WriteOptions,
  type ListOptions,
  type CopyMoveOptions,
  type AIFileResult,
  type AIOptions as FSXAIOptions
} from './fsx.js'

// Git Extended Primitive
export {
  GitX,
  createGitX,
  gitx,
  type Commit,
  type Branch,
  type FileStatus,
  type RepoStatus,
  type DiffInfo,
  type DiffHunk,
  type DiffLine,
  type CommitOptions,
  type BranchOptions,
  type MergeOptions,
  type AIGitOptions,
  type AICommitMessage,
  type AIReviewResult
} from './gitx.js'

// Bash/Shell Extended Primitive
export {
  BashX,
  createBashX,
  bashx,
  type ExecResult,
  type ExecOptions,
  type Command,
  type PipelineResult,
  type AIBashOptions,
  type AICommandResult,
  type AIDiagnosisResult
} from './bashx.js'
