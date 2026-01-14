import { describe, it, expect } from 'vitest'
import {
  FSError,
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  EACCES,
  EPERM,
  ENOTEMPTY,
  EBADF,
  EINVAL,
  ELOOP,
  ENAMETOOLONG,
  ENOSPC,
  EROFS,
  EBUSY,
  EMFILE,
  ENFILE,
  EXDEV,
  // Type guards
  isFSError,
  isEnoent,
  isEexist,
  isEisdir,
  isEnotdir,
  isEacces,
  isEperm,
  isEnotempty,
  isEbadf,
  isEinval,
  isEloop,
  isEnametoolong,
  isEnospc,
  isErofs,
  isEbusy,
  isEmfile,
  isEnfile,
  isExdev,
  // Helper functions
  hasErrorCode,
  getErrorCode,
  createError,
  ALL_ERROR_CODES,
  // Types
  type ErrorCode,
} from './errors'

describe('FSError', () => {
  it('should create error with correct properties', () => {
    const error = new FSError('ETEST', -999, 'test error', 'test', '/test/path')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error.name).toBe('FSError')
    expect(error.code).toBe('ETEST')
    expect(error.errno).toBe(-999)
    expect(error.syscall).toBe('test')
    expect(error.path).toBe('/test/path')
  })

  it('should format error message correctly with all properties', () => {
    const error = new FSError('ETEST', -999, 'test error', 'test', '/test/path')
    expect(error.message).toBe("ETEST: test error, test '/test/path'")
  })

  it('should format error message correctly without optional properties', () => {
    const error = new FSError('ETEST', -999, 'test error')
    expect(error.message).toBe('ETEST: test error')
  })

  it('should format error message correctly with syscall but no path', () => {
    const error = new FSError('ETEST', -999, 'test error', 'test')
    expect(error.message).toBe('ETEST: test error, test')
  })

  it('should format error message correctly with dest for cross-device errors', () => {
    const error = new FSError('EXDEV', -18, 'cross-device link not permitted', 'rename', '/src', '/dest')
    expect(error.message).toBe("EXDEV: cross-device link not permitted, rename '/src' -> '/dest'")
    expect(error.dest).toBe('/dest')
  })
})

describe('ENOENT', () => {
  it('should have correct error code and errno', () => {
    const error = new ENOENT()
    expect(error.code).toBe('ENOENT')
    expect(error.errno).toBe(-2)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENOENT()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENOENT)
  })

  it('should have correct name', () => {
    const error = new ENOENT()
    expect(error.name).toBe('ENOENT')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ENOENT('open', '/test/file.txt')
    expect(error.message).toBe("ENOENT: no such file or directory, open '/test/file.txt'")
    expect(error.syscall).toBe('open')
    expect(error.path).toBe('/test/file.txt')
  })

  it('should format message correctly without syscall and path', () => {
    const error = new ENOENT()
    expect(error.message).toBe('ENOENT: no such file or directory')
    expect(error.syscall).toBeUndefined()
    expect(error.path).toBeUndefined()
  })
})

describe('EEXIST', () => {
  it('should have correct error code and errno', () => {
    const error = new EEXIST()
    expect(error.code).toBe('EEXIST')
    expect(error.errno).toBe(-17)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EEXIST()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EEXIST)
  })

  it('should have correct name', () => {
    const error = new EEXIST()
    expect(error.name).toBe('EEXIST')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EEXIST('mkdir', '/test/existing')
    expect(error.message).toBe("EEXIST: file already exists, mkdir '/test/existing'")
    expect(error.syscall).toBe('mkdir')
    expect(error.path).toBe('/test/existing')
  })
})

describe('EISDIR', () => {
  it('should have correct error code and errno', () => {
    const error = new EISDIR()
    expect(error.code).toBe('EISDIR')
    expect(error.errno).toBe(-21)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EISDIR()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EISDIR)
  })

  it('should have correct name', () => {
    const error = new EISDIR()
    expect(error.name).toBe('EISDIR')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EISDIR('read', '/test/dir')
    expect(error.message).toBe("EISDIR: illegal operation on a directory, read '/test/dir'")
    expect(error.syscall).toBe('read')
    expect(error.path).toBe('/test/dir')
  })
})

describe('ENOTDIR', () => {
  it('should have correct error code and errno', () => {
    const error = new ENOTDIR()
    expect(error.code).toBe('ENOTDIR')
    expect(error.errno).toBe(-20)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENOTDIR()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENOTDIR)
  })

  it('should have correct name', () => {
    const error = new ENOTDIR()
    expect(error.name).toBe('ENOTDIR')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ENOTDIR('scandir', '/test/file.txt')
    expect(error.message).toBe("ENOTDIR: not a directory, scandir '/test/file.txt'")
    expect(error.syscall).toBe('scandir')
    expect(error.path).toBe('/test/file.txt')
  })
})

describe('EACCES', () => {
  it('should have correct error code and errno', () => {
    const error = new EACCES()
    expect(error.code).toBe('EACCES')
    expect(error.errno).toBe(-13)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EACCES()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EACCES)
  })

  it('should have correct name', () => {
    const error = new EACCES()
    expect(error.name).toBe('EACCES')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EACCES('open', '/test/protected.txt')
    expect(error.message).toBe("EACCES: permission denied, open '/test/protected.txt'")
    expect(error.syscall).toBe('open')
    expect(error.path).toBe('/test/protected.txt')
  })
})

describe('EPERM', () => {
  it('should have correct error code and errno', () => {
    const error = new EPERM()
    expect(error.code).toBe('EPERM')
    expect(error.errno).toBe(-1)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EPERM()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EPERM)
  })

  it('should have correct name', () => {
    const error = new EPERM()
    expect(error.name).toBe('EPERM')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EPERM('chmod', '/test/file.txt')
    expect(error.message).toBe("EPERM: operation not permitted, chmod '/test/file.txt'")
    expect(error.syscall).toBe('chmod')
    expect(error.path).toBe('/test/file.txt')
  })
})

describe('ENOTEMPTY', () => {
  it('should have correct error code and errno', () => {
    const error = new ENOTEMPTY()
    expect(error.code).toBe('ENOTEMPTY')
    expect(error.errno).toBe(-39)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENOTEMPTY()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENOTEMPTY)
  })

  it('should have correct name', () => {
    const error = new ENOTEMPTY()
    expect(error.name).toBe('ENOTEMPTY')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ENOTEMPTY('rmdir', '/test/nonempty')
    expect(error.message).toBe("ENOTEMPTY: directory not empty, rmdir '/test/nonempty'")
    expect(error.syscall).toBe('rmdir')
    expect(error.path).toBe('/test/nonempty')
  })
})

describe('EBADF', () => {
  it('should have correct error code and errno', () => {
    const error = new EBADF()
    expect(error.code).toBe('EBADF')
    expect(error.errno).toBe(-9)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EBADF()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EBADF)
  })

  it('should have correct name', () => {
    const error = new EBADF()
    expect(error.name).toBe('EBADF')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EBADF('read')
    expect(error.message).toBe('EBADF: bad file descriptor, read')
    expect(error.syscall).toBe('read')
  })
})

describe('EINVAL', () => {
  it('should have correct error code and errno', () => {
    const error = new EINVAL()
    expect(error.code).toBe('EINVAL')
    expect(error.errno).toBe(-22)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EINVAL()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EINVAL)
  })

  it('should have correct name', () => {
    const error = new EINVAL()
    expect(error.name).toBe('EINVAL')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EINVAL('read', '/test/file.txt')
    expect(error.message).toBe("EINVAL: invalid argument, read '/test/file.txt'")
    expect(error.syscall).toBe('read')
    expect(error.path).toBe('/test/file.txt')
  })
})

describe('EMFILE', () => {
  it('should have correct error code and errno', () => {
    const error = new EMFILE()
    expect(error.code).toBe('EMFILE')
    expect(error.errno).toBe(-24)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EMFILE()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EMFILE)
  })

  it('should have correct name', () => {
    const error = new EMFILE()
    expect(error.name).toBe('EMFILE')
  })

  it('should format message correctly with syscall', () => {
    const error = new EMFILE('open')
    expect(error.message).toBe('EMFILE: too many open files, open')
    expect(error.syscall).toBe('open')
  })
})

describe('ENFILE', () => {
  it('should have correct error code and errno', () => {
    const error = new ENFILE()
    expect(error.code).toBe('ENFILE')
    expect(error.errno).toBe(-23)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENFILE()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENFILE)
  })

  it('should have correct name', () => {
    const error = new ENFILE()
    expect(error.name).toBe('ENFILE')
  })

  it('should format message correctly with syscall', () => {
    const error = new ENFILE('open')
    expect(error.message).toBe('ENFILE: file table overflow, open')
    expect(error.syscall).toBe('open')
  })
})

describe('ENOSPC', () => {
  it('should have correct error code and errno', () => {
    const error = new ENOSPC()
    expect(error.code).toBe('ENOSPC')
    expect(error.errno).toBe(-28)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENOSPC()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENOSPC)
  })

  it('should have correct name', () => {
    const error = new ENOSPC()
    expect(error.name).toBe('ENOSPC')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ENOSPC('write', '/test/file.txt')
    expect(error.message).toBe("ENOSPC: no space left on device, write '/test/file.txt'")
    expect(error.syscall).toBe('write')
    expect(error.path).toBe('/test/file.txt')
  })
})

describe('EROFS', () => {
  it('should have correct error code and errno', () => {
    const error = new EROFS()
    expect(error.code).toBe('EROFS')
    expect(error.errno).toBe(-30)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EROFS()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EROFS)
  })

  it('should have correct name', () => {
    const error = new EROFS()
    expect(error.name).toBe('EROFS')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EROFS('write', '/test/file.txt')
    expect(error.message).toBe("EROFS: read-only file system, write '/test/file.txt'")
    expect(error.syscall).toBe('write')
    expect(error.path).toBe('/test/file.txt')
  })
})

describe('ELOOP', () => {
  it('should have correct error code and errno', () => {
    const error = new ELOOP()
    expect(error.code).toBe('ELOOP')
    expect(error.errno).toBe(-40)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ELOOP()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ELOOP)
  })

  it('should have correct name', () => {
    const error = new ELOOP()
    expect(error.name).toBe('ELOOP')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ELOOP('readlink', '/test/circular')
    expect(error.message).toBe("ELOOP: too many levels of symbolic links, readlink '/test/circular'")
    expect(error.syscall).toBe('readlink')
    expect(error.path).toBe('/test/circular')
  })
})

describe('ENAMETOOLONG', () => {
  it('should have correct error code and errno', () => {
    const error = new ENAMETOOLONG()
    expect(error.code).toBe('ENAMETOOLONG')
    expect(error.errno).toBe(-36)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new ENAMETOOLONG()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(ENAMETOOLONG)
  })

  it('should have correct name', () => {
    const error = new ENAMETOOLONG()
    expect(error.name).toBe('ENAMETOOLONG')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new ENAMETOOLONG('open', '/test/' + 'x'.repeat(300))
    expect(error.message).toContain('ENAMETOOLONG: file name too long, open')
    expect(error.syscall).toBe('open')
  })
})

describe('EBUSY', () => {
  it('should have correct error code and errno', () => {
    const error = new EBUSY()
    expect(error.code).toBe('EBUSY')
    expect(error.errno).toBe(-16)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EBUSY()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EBUSY)
  })

  it('should have correct name', () => {
    const error = new EBUSY()
    expect(error.name).toBe('EBUSY')
  })

  it('should format message correctly with syscall and path', () => {
    const error = new EBUSY('unlink', '/test/locked.txt')
    expect(error.message).toBe("EBUSY: resource busy or locked, unlink '/test/locked.txt'")
    expect(error.syscall).toBe('unlink')
    expect(error.path).toBe('/test/locked.txt')
  })
})

describe('EXDEV', () => {
  it('should have correct error code and errno', () => {
    const error = new EXDEV()
    expect(error.code).toBe('EXDEV')
    expect(error.errno).toBe(-18)
  })

  it('should be instanceof Error and FSError', () => {
    const error = new EXDEV()
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(FSError)
    expect(error).toBeInstanceOf(EXDEV)
  })

  it('should have correct name', () => {
    const error = new EXDEV()
    expect(error.name).toBe('EXDEV')
  })

  it('should format message correctly with syscall, path, and dest', () => {
    const error = new EXDEV('rename', '/mnt/vol1/file.txt', '/mnt/vol2/file.txt')
    expect(error.message).toBe("EXDEV: cross-device link not permitted, rename '/mnt/vol1/file.txt' -> '/mnt/vol2/file.txt'")
    expect(error.syscall).toBe('rename')
    expect(error.path).toBe('/mnt/vol1/file.txt')
    expect(error.dest).toBe('/mnt/vol2/file.txt')
  })

  it('should format message correctly without dest', () => {
    const error = new EXDEV('link', '/test/file.txt')
    expect(error.message).toBe("EXDEV: cross-device link not permitted, link '/test/file.txt'")
    expect(error.syscall).toBe('link')
    expect(error.path).toBe('/test/file.txt')
    expect(error.dest).toBeUndefined()
  })
})

// ============================================================================
// Type Guards Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isFSError', () => {
    it('should return true for FSError instances', () => {
      expect(isFSError(new FSError('ETEST', -1, 'test'))).toBe(true)
      expect(isFSError(new ENOENT())).toBe(true)
      expect(isFSError(new EEXIST())).toBe(true)
    })

    it('should return false for non-FSError values', () => {
      expect(isFSError(new Error('test'))).toBe(false)
      expect(isFSError('ENOENT')).toBe(false)
      expect(isFSError(null)).toBe(false)
      expect(isFSError(undefined)).toBe(false)
      expect(isFSError({ code: 'ENOENT' })).toBe(false)
    })
  })

  describe('isEnoent', () => {
    it('should return true for ENOENT instances', () => {
      expect(isEnoent(new ENOENT())).toBe(true)
      expect(isEnoent(new ENOENT('open', '/file.txt'))).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnoent(new EEXIST())).toBe(false)
      expect(isEnoent(new Error('ENOENT'))).toBe(false)
      expect(isEnoent(null)).toBe(false)
    })
  })

  describe('isEexist', () => {
    it('should return true for EEXIST instances', () => {
      expect(isEexist(new EEXIST())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEexist(new ENOENT())).toBe(false)
    })
  })

  describe('isEisdir', () => {
    it('should return true for EISDIR instances', () => {
      expect(isEisdir(new EISDIR())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEisdir(new ENOTDIR())).toBe(false)
    })
  })

  describe('isEnotdir', () => {
    it('should return true for ENOTDIR instances', () => {
      expect(isEnotdir(new ENOTDIR())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnotdir(new EISDIR())).toBe(false)
    })
  })

  describe('isEacces', () => {
    it('should return true for EACCES instances', () => {
      expect(isEacces(new EACCES())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEacces(new EPERM())).toBe(false)
    })
  })

  describe('isEperm', () => {
    it('should return true for EPERM instances', () => {
      expect(isEperm(new EPERM())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEperm(new EACCES())).toBe(false)
    })
  })

  describe('isEnotempty', () => {
    it('should return true for ENOTEMPTY instances', () => {
      expect(isEnotempty(new ENOTEMPTY())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnotempty(new ENOENT())).toBe(false)
    })
  })

  describe('isEbadf', () => {
    it('should return true for EBADF instances', () => {
      expect(isEbadf(new EBADF())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEbadf(new EINVAL())).toBe(false)
    })
  })

  describe('isEinval', () => {
    it('should return true for EINVAL instances', () => {
      expect(isEinval(new EINVAL())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEinval(new EBADF())).toBe(false)
    })
  })

  describe('isEloop', () => {
    it('should return true for ELOOP instances', () => {
      expect(isEloop(new ELOOP())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEloop(new ENOENT())).toBe(false)
    })
  })

  describe('isEnametoolong', () => {
    it('should return true for ENAMETOOLONG instances', () => {
      expect(isEnametoolong(new ENAMETOOLONG())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnametoolong(new EINVAL())).toBe(false)
    })
  })

  describe('isEnospc', () => {
    it('should return true for ENOSPC instances', () => {
      expect(isEnospc(new ENOSPC())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnospc(new EROFS())).toBe(false)
    })
  })

  describe('isErofs', () => {
    it('should return true for EROFS instances', () => {
      expect(isErofs(new EROFS())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isErofs(new ENOSPC())).toBe(false)
    })
  })

  describe('isEbusy', () => {
    it('should return true for EBUSY instances', () => {
      expect(isEbusy(new EBUSY())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEbusy(new ENOENT())).toBe(false)
    })
  })

  describe('isEmfile', () => {
    it('should return true for EMFILE instances', () => {
      expect(isEmfile(new EMFILE())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEmfile(new ENFILE())).toBe(false)
    })
  })

  describe('isEnfile', () => {
    it('should return true for ENFILE instances', () => {
      expect(isEnfile(new ENFILE())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isEnfile(new EMFILE())).toBe(false)
    })
  })

  describe('isExdev', () => {
    it('should return true for EXDEV instances', () => {
      expect(isExdev(new EXDEV())).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isExdev(new ENOENT())).toBe(false)
    })
  })
})

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('Helper Functions', () => {
  describe('hasErrorCode', () => {
    it('should return true when error has matching code', () => {
      expect(hasErrorCode(new ENOENT(), 'ENOENT')).toBe(true)
      expect(hasErrorCode(new EEXIST(), 'EEXIST')).toBe(true)
      expect(hasErrorCode(new EISDIR(), 'EISDIR')).toBe(true)
    })

    it('should return false when error has different code', () => {
      expect(hasErrorCode(new ENOENT(), 'EEXIST')).toBe(false)
      expect(hasErrorCode(new EEXIST(), 'ENOENT')).toBe(false)
    })

    it('should return false for non-FSError values', () => {
      expect(hasErrorCode(new Error('test'), 'ENOENT')).toBe(false)
      expect(hasErrorCode(null, 'ENOENT')).toBe(false)
      expect(hasErrorCode({ code: 'ENOENT' }, 'ENOENT')).toBe(false)
    })
  })

  describe('getErrorCode', () => {
    it('should return the error code for FSError instances', () => {
      expect(getErrorCode(new ENOENT())).toBe('ENOENT')
      expect(getErrorCode(new EEXIST())).toBe('EEXIST')
      expect(getErrorCode(new EISDIR())).toBe('EISDIR')
      expect(getErrorCode(new EXDEV())).toBe('EXDEV')
    })

    it('should return undefined for non-FSError values', () => {
      expect(getErrorCode(new Error('test'))).toBeUndefined()
      expect(getErrorCode(null)).toBeUndefined()
      expect(getErrorCode(undefined)).toBeUndefined()
      expect(getErrorCode('ENOENT')).toBeUndefined()
    })

    it('should return undefined for FSError with unknown code', () => {
      const customError = new FSError('EUNKNOWN', -999, 'unknown error')
      expect(getErrorCode(customError)).toBeUndefined()
    })
  })

  describe('createError', () => {
    it('should create correct error type for each code', () => {
      const codes: ErrorCode[] = [
        'ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM',
        'ENOTEMPTY', 'EBADF', 'EINVAL', 'ELOOP', 'ENAMETOOLONG',
        'ENOSPC', 'EROFS', 'EBUSY', 'EMFILE', 'ENFILE', 'EXDEV'
      ]

      for (const code of codes) {
        const error = createError(code)
        expect(error.code).toBe(code)
        expect(error.name).toBe(code)
        expect(error).toBeInstanceOf(FSError)
      }
    })

    it('should pass syscall and path to created error', () => {
      const error = createError('ENOENT', 'open', '/test/file.txt')
      expect(error.code).toBe('ENOENT')
      expect(error.syscall).toBe('open')
      expect(error.path).toBe('/test/file.txt')
      expect(error.message).toBe("ENOENT: no such file or directory, open '/test/file.txt'")
    })

    it('should pass dest for cross-device errors', () => {
      const error = createError('EXDEV', 'rename', '/src', '/dest')
      expect(error.code).toBe('EXDEV')
      expect(error.path).toBe('/src')
      expect(error.dest).toBe('/dest')
      expect(error.message).toBe("EXDEV: cross-device link not permitted, rename '/src' -> '/dest'")
    })

    it('should create error with correct instanceof chain', () => {
      const error = createError('ENOENT', 'open', '/file.txt')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(FSError)
      expect(error).toBeInstanceOf(ENOENT)
    })
  })

  describe('ALL_ERROR_CODES', () => {
    it('should contain all 17 error codes', () => {
      expect(ALL_ERROR_CODES).toHaveLength(17)
    })

    it('should include all expected codes', () => {
      const expectedCodes: ErrorCode[] = [
        'ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM',
        'ENOTEMPTY', 'EBADF', 'EINVAL', 'ELOOP', 'ENAMETOOLONG',
        'ENOSPC', 'EROFS', 'EBUSY', 'EMFILE', 'ENFILE', 'EXDEV'
      ]

      for (const code of expectedCodes) {
        expect(ALL_ERROR_CODES).toContain(code)
      }
    })

    it('should be an array type', () => {
      // TypeScript provides compile-time readonly enforcement
      // At runtime, we just verify it's an array
      expect(Array.isArray(ALL_ERROR_CODES)).toBe(true)
    })
  })
})
