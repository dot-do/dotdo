// Git errors for gitx primitive

/**
 * Base class for all gitx errors
 */
export class GitxError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'GitxError'
    this.code = code
  }
}

/**
 * Repository not found or not initialized
 */
export class RepositoryNotFoundError extends GitxError {
  constructor(path?: string) {
    super(
      path ? `Repository not found at '${path}'` : 'Repository not initialized',
      'REPO_NOT_FOUND'
    )
    this.name = 'RepositoryNotFoundError'
  }
}

/**
 * Reference (branch/tag) not found
 */
export class RefNotFoundError extends GitxError {
  readonly ref: string

  constructor(ref: string) {
    super(`Reference not found: ${ref}`, 'REF_NOT_FOUND')
    this.name = 'RefNotFoundError'
    this.ref = ref
  }
}

/**
 * Object not found in object database
 */
export class ObjectNotFoundError extends GitxError {
  readonly hash: string

  constructor(hash: string) {
    super(`Object not found: ${hash}`, 'OBJECT_NOT_FOUND')
    this.name = 'ObjectNotFoundError'
    this.hash = hash
  }
}

/**
 * Merge conflict
 */
export class MergeConflictError extends GitxError {
  readonly conflicts: string[]

  constructor(conflicts: string[]) {
    super(`Merge conflict in: ${conflicts.join(', ')}`, 'MERGE_CONFLICT')
    this.name = 'MergeConflictError'
    this.conflicts = conflicts
  }
}

/**
 * Detached HEAD state error
 */
export class DetachedHeadError extends GitxError {
  constructor() {
    super('Operation not allowed in detached HEAD state', 'DETACHED_HEAD')
    this.name = 'DetachedHeadError'
  }
}

/**
 * Working tree is dirty
 */
export class DirtyWorkingTreeError extends GitxError {
  readonly paths: string[]

  constructor(paths: string[]) {
    super(`Working tree has uncommitted changes: ${paths.slice(0, 5).join(', ')}`, 'DIRTY_WORKTREE')
    this.name = 'DirtyWorkingTreeError'
    this.paths = paths
  }
}

/**
 * Remote operation failed
 */
export class RemoteError extends GitxError {
  readonly remote: string

  constructor(message: string, remote: string) {
    super(`Remote error (${remote}): ${message}`, 'REMOTE_ERROR')
    this.name = 'RemoteError'
    this.remote = remote
  }
}

/**
 * Authentication failed
 */
export class AuthenticationError extends GitxError {
  constructor(message?: string) {
    super(message ?? 'Authentication failed', 'AUTH_FAILED')
    this.name = 'AuthenticationError'
  }
}

/**
 * Invalid object format
 */
export class InvalidObjectError extends GitxError {
  constructor(message: string) {
    super(message, 'INVALID_OBJECT')
    this.name = 'InvalidObjectError'
  }
}

/**
 * Operation not allowed
 */
export class OperationNotAllowedError extends GitxError {
  constructor(operation: string, reason: string) {
    super(`Operation '${operation}' not allowed: ${reason}`, 'NOT_ALLOWED')
    this.name = 'OperationNotAllowedError'
  }
}
