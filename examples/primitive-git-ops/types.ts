// Primitive Git Ops Example - Type definitions

export interface GitConfig {
  repo: string
  branch: string
  owner?: string
}

export interface FileChange {
  path: string
  content: string
  mode?: 'create' | 'update' | 'delete'
}

export interface CommitInfo {
  sha: string
  message: string
  author: string
  timestamp: string
  parents: string[]
}

export interface BranchInfo {
  name: string
  sha: string
  isDefault: boolean
}

export interface StatusInfo {
  branch: string
  head?: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  clean: boolean
}

export interface DeployResult {
  success: boolean
  branch: string
  commit?: string
  pr?: {
    number: number
    url: string
  }
  error?: string
}

export interface ReviewComment {
  path: string
  line: number
  message: string
  severity: 'error' | 'warning' | 'info'
}

export interface ReviewResult {
  approved: boolean
  comments: ReviewComment[]
  summary: string
}

export interface DiffEntry {
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
}

export interface GitFile {
  $type: 'GitFile'
  path: string
  content: string
  mode: string
  sha?: string
}

export interface GitCommit {
  $type: 'GitCommit'
  sha: string
  message: string
  author: {
    name: string
    email: string
  }
  timestamp: string
  tree: string
  parents: string[]
}

export interface GitRef {
  $type: 'GitRef'
  name: string
  sha: string
  type: 'branch' | 'tag'
}

export interface GitBackup {
  $type: 'GitBackup'
  timestamp: string
  branch: string
  commits: CommitInfo[]
  fileCount: number
}
