// File system errors for fsx primitive

/**
 * Base class for all fsx errors
 */
export class FsxError extends Error {
  readonly code: string
  readonly path?: string
  readonly syscall?: string

  constructor(message: string, code: string, options?: { path?: string; syscall?: string }) {
    super(message)
    this.name = 'FsxError'
    this.code = code
    this.path = options?.path
    this.syscall = options?.syscall
  }
}

/**
 * File or directory not found
 */
export class ENOENT extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`ENOENT: no such file or directory, ${syscall ?? 'open'} '${path}'`, 'ENOENT', { path, syscall })
    this.name = 'ENOENT'
  }
}

/**
 * File or directory already exists
 */
export class EEXIST extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`EEXIST: file already exists, ${syscall ?? 'mkdir'} '${path}'`, 'EEXIST', { path, syscall })
    this.name = 'EEXIST'
  }
}

/**
 * Not a directory
 */
export class ENOTDIR extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`ENOTDIR: not a directory, ${syscall ?? 'scandir'} '${path}'`, 'ENOTDIR', { path, syscall })
    this.name = 'ENOTDIR'
  }
}

/**
 * Is a directory (when file expected)
 */
export class EISDIR extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`EISDIR: illegal operation on a directory, ${syscall ?? 'read'} '${path}'`, 'EISDIR', { path, syscall })
    this.name = 'EISDIR'
  }
}

/**
 * Directory not empty
 */
export class ENOTEMPTY extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`ENOTEMPTY: directory not empty, ${syscall ?? 'rmdir'} '${path}'`, 'ENOTEMPTY', { path, syscall })
    this.name = 'ENOTEMPTY'
  }
}

/**
 * Invalid argument
 */
export class EINVAL extends FsxError {
  constructor(message: string, path?: string, syscall?: string) {
    super(`EINVAL: invalid argument, ${message}`, 'EINVAL', { path, syscall })
    this.name = 'EINVAL'
  }
}

/**
 * Permission denied
 */
export class EACCES extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`EACCES: permission denied, ${syscall ?? 'open'} '${path}'`, 'EACCES', { path, syscall })
    this.name = 'EACCES'
  }
}

/**
 * Too many symbolic links encountered
 */
export class ELOOP extends FsxError {
  constructor(path: string, syscall?: string) {
    super(`ELOOP: too many symbolic links encountered, ${syscall ?? 'stat'} '${path}'`, 'ELOOP', { path, syscall })
    this.name = 'ELOOP'
  }
}
