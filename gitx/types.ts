// Git types for gitx primitive

/**
 * Git object types
 */
export type GitObjectType = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Git object representing stored data
 */
export interface GitObject {
  /** SHA-1 hash of the object */
  hash: string
  /** Object type */
  type: GitObjectType
  /** Object size in bytes */
  size: number
  /** Object content */
  content: Uint8Array
}

/**
 * Git blob (file content)
 */
export interface GitBlob {
  hash: string
  type: 'blob'
  content: Uint8Array
  size: number
}

/**
 * Git tree entry (directory entry)
 */
export interface GitTreeEntry {
  /** File mode (100644 for files, 40000 for dirs, etc.) */
  mode: string
  /** Entry name */
  name: string
  /** SHA-1 hash of the object */
  hash: string
  /** Object type */
  type: 'blob' | 'tree'
}

/**
 * Git tree (directory)
 */
export interface GitTree {
  hash: string
  type: 'tree'
  entries: GitTreeEntry[]
}

/**
 * Git commit signature
 */
export interface GitSignature {
  name: string
  email: string
  timestamp: number
  timezone: string
}

/**
 * Git commit
 */
export interface GitCommit {
  hash: string
  type: 'commit'
  tree: string
  parents: string[]
  author: GitSignature
  committer: GitSignature
  message: string
  gpgSignature?: string
}

/**
 * Git reference (branch, tag, etc.)
 */
export interface GitRef {
  name: string
  hash: string
  symbolic?: string
}

/**
 * Git branch
 */
export interface GitBranch {
  name: string
  hash: string
  isRemote: boolean
  upstream?: string
}

/**
 * Git tag
 */
export interface GitTag {
  name: string
  hash: string
  isAnnotated: boolean
  message?: string
  tagger?: GitSignature
}

/**
 * Git status entry
 */
export interface GitStatusEntry {
  path: string
  /** Staged status: ' ' unmodified, 'M' modified, 'A' added, 'D' deleted, 'R' renamed, 'C' copied, '?' untracked */
  staged: string
  /** Working tree status */
  workTree: string
  /** Original path (for renames) */
  origPath?: string
}

/**
 * Git status summary
 */
export interface GitStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  entries: GitStatusEntry[]
}

/**
 * Git diff hunk
 */
export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

/**
 * Git diff for a file
 */
export interface GitFileDiff {
  oldPath: string
  newPath: string
  oldMode?: string
  newMode?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'
  hunks: GitDiffHunk[]
  binary: boolean
}

/**
 * Git log entry
 */
export interface GitLogEntry {
  hash: string
  shortHash: string
  tree: string
  parents: string[]
  author: GitSignature
  committer: GitSignature
  message: string
  summary: string
}

/**
 * Git log options
 */
export interface GitLogOptions {
  /** Maximum number of commits */
  maxCount?: number
  /** Skip first n commits */
  skip?: number
  /** Start from ref */
  ref?: string
  /** Filter by paths */
  paths?: string[]
  /** Filter by author */
  author?: string
  /** Filter by committer */
  committer?: string
  /** After date */
  since?: Date
  /** Before date */
  until?: Date
  /** Include merge commits */
  merges?: boolean
  /** First parent only (for merges) */
  firstParent?: boolean
}

/**
 * Git clone options
 */
export interface GitCloneOptions {
  /** Clone depth (shallow clone) */
  depth?: number
  /** Branch to checkout */
  branch?: string
  /** Single branch only */
  singleBranch?: boolean
  /** No checkout after clone */
  noCheckout?: boolean
}

/**
 * Git commit options
 */
export interface GitCommitOptions {
  /** Commit message */
  message: string
  /** Author signature override */
  author?: Partial<GitSignature>
  /** Committer signature override */
  committer?: Partial<GitSignature>
  /** Allow empty commits */
  allowEmpty?: boolean
  /** Amend last commit */
  amend?: boolean
}

/**
 * Git push options
 */
export interface GitPushOptions {
  /** Remote name */
  remote?: string
  /** Force push */
  force?: boolean
  /** Set upstream */
  setUpstream?: boolean
  /** Tags */
  tags?: boolean
}

/**
 * Git pull options
 */
export interface GitPullOptions {
  /** Remote name */
  remote?: string
  /** Rebase instead of merge */
  rebase?: boolean
  /** Fast-forward only */
  ffOnly?: boolean
}

/**
 * Git merge options
 */
export interface GitMergeOptions {
  /** Commit message */
  message?: string
  /** Fast-forward mode: 'ff', 'no-ff', 'ff-only' */
  ff?: 'ff' | 'no-ff' | 'ff-only'
  /** Squash */
  squash?: boolean
  /** Strategy */
  strategy?: string
}

/**
 * Git rebase options
 */
export interface GitRebaseOptions {
  /** Onto base */
  onto?: string
  /** Interactive */
  interactive?: boolean
  /** Preserve merges */
  preserveMerges?: boolean
}

/**
 * Git stash entry
 */
export interface GitStashEntry {
  index: number
  message: string
  branch: string
  hash: string
}

/**
 * Git remote
 */
export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

/**
 * Git config entry
 */
export interface GitConfigEntry {
  key: string
  value: string
  scope: 'local' | 'global' | 'system'
}
