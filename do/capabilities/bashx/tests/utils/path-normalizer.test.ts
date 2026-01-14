/**
 * Path Normalizer Tests
 *
 * Tests for cross-platform path normalization utilities.
 * Covers Unix/Windows path conversion, drive letters, UNC paths,
 * home directory expansion, environment variable expansion, and security.
 */

import { describe, it, expect } from 'vitest'
import {
  toUnixPath,
  toWindowsPath,
  resolvePath,
  expandPath,
  normalizePath,
  isAbsolutePath,
  detectPlatform,
  PathPlatform,
  validatePathSecurity,
  PathSecurityError,
} from '../../src/utils/path-normalizer.js'

describe('Path Normalizer', () => {
  // ===========================================================================
  // toUnixPath Tests
  // ===========================================================================

  describe('toUnixPath', () => {
    describe('Forward/Backslash Conversion', () => {
      it('should convert backslashes to forward slashes', () => {
        expect(toUnixPath('foo\\bar\\baz')).toBe('foo/bar/baz')
      })

      it('should handle mixed slashes', () => {
        expect(toUnixPath('foo/bar\\baz/qux')).toBe('foo/bar/baz/qux')
      })

      it('should preserve forward slashes', () => {
        expect(toUnixPath('foo/bar/baz')).toBe('foo/bar/baz')
      })

      it('should handle double backslashes', () => {
        expect(toUnixPath('foo\\\\bar')).toBe('foo/bar')
      })

      it('should handle trailing slashes', () => {
        expect(toUnixPath('foo\\bar\\')).toBe('foo/bar/')
      })
    })

    describe('Drive Letter Handling', () => {
      it('should convert C: to /c', () => {
        expect(toUnixPath('C:\\Users\\test')).toBe('/c/Users/test')
      })

      it('should convert lowercase drive letters', () => {
        expect(toUnixPath('c:\\Users\\test')).toBe('/c/Users/test')
      })

      it('should handle D: drive', () => {
        expect(toUnixPath('D:\\Projects')).toBe('/d/Projects')
      })

      it('should handle drive letter with forward slashes', () => {
        expect(toUnixPath('C:/Users/test')).toBe('/c/Users/test')
      })

      it('should handle bare drive letter', () => {
        expect(toUnixPath('C:')).toBe('/c')
      })

      it('should handle drive letter with trailing backslash', () => {
        expect(toUnixPath('C:\\')).toBe('/c/')
      })
    })

    describe('UNC Path Support', () => {
      it('should convert UNC path \\\\server\\share', () => {
        expect(toUnixPath('\\\\server\\share')).toBe('//server/share')
      })

      it('should convert UNC path with subfolders', () => {
        expect(toUnixPath('\\\\server\\share\\folder\\file.txt')).toBe('//server/share/folder/file.txt')
      })

      it('should handle UNC path with forward slashes', () => {
        expect(toUnixPath('//server/share')).toBe('//server/share')
      })

      it('should handle UNC path \\\\?\\C:\\', () => {
        expect(toUnixPath('\\\\?\\C:\\Users')).toBe('/c/Users')
      })
    })

    describe('Relative Paths', () => {
      it('should preserve relative paths', () => {
        expect(toUnixPath('foo/bar')).toBe('foo/bar')
      })

      it('should handle dot paths', () => {
        expect(toUnixPath('.\\foo\\bar')).toBe('./foo/bar')
      })

      it('should handle double dot paths', () => {
        expect(toUnixPath('..\\foo\\bar')).toBe('../foo/bar')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty string', () => {
        expect(toUnixPath('')).toBe('')
      })

      it('should handle root path', () => {
        expect(toUnixPath('/')).toBe('/')
      })

      it('should handle Windows root', () => {
        expect(toUnixPath('\\')).toBe('/')
      })

      it('should handle single dot', () => {
        expect(toUnixPath('.')).toBe('.')
      })

      it('should handle double dot', () => {
        expect(toUnixPath('..')).toBe('..')
      })
    })
  })

  // ===========================================================================
  // toWindowsPath Tests
  // ===========================================================================

  describe('toWindowsPath', () => {
    describe('Forward/Backslash Conversion', () => {
      it('should convert forward slashes to backslashes', () => {
        expect(toWindowsPath('foo/bar/baz')).toBe('foo\\bar\\baz')
      })

      it('should preserve backslashes', () => {
        expect(toWindowsPath('foo\\bar\\baz')).toBe('foo\\bar\\baz')
      })

      it('should handle mixed slashes', () => {
        expect(toWindowsPath('foo/bar\\baz')).toBe('foo\\bar\\baz')
      })
    })

    describe('Drive Letter Handling', () => {
      it('should convert /c to C:', () => {
        expect(toWindowsPath('/c/Users/test')).toBe('C:\\Users\\test')
      })

      it('should convert /C to C:', () => {
        expect(toWindowsPath('/C/Users/test')).toBe('C:\\Users\\test')
      })

      it('should convert /d to D:', () => {
        expect(toWindowsPath('/d/Projects')).toBe('D:\\Projects')
      })

      it('should handle bare Unix drive path', () => {
        expect(toWindowsPath('/c')).toBe('C:\\')
      })

      it('should handle Unix drive path with trailing slash', () => {
        expect(toWindowsPath('/c/')).toBe('C:\\')
      })
    })

    describe('UNC Path Support', () => {
      it('should convert //server/share to UNC path', () => {
        expect(toWindowsPath('//server/share')).toBe('\\\\server\\share')
      })

      it('should convert UNC path with subfolders', () => {
        expect(toWindowsPath('//server/share/folder/file.txt')).toBe('\\\\server\\share\\folder\\file.txt')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty string', () => {
        expect(toWindowsPath('')).toBe('')
      })

      it('should handle Unix root', () => {
        expect(toWindowsPath('/')).toBe('\\')
      })

      it('should handle relative paths', () => {
        expect(toWindowsPath('./foo/bar')).toBe('.\\foo\\bar')
      })

      it('should handle parent paths', () => {
        expect(toWindowsPath('../foo/bar')).toBe('..\\foo\\bar')
      })
    })
  })

  // ===========================================================================
  // resolvePath Tests
  // ===========================================================================

  describe('resolvePath', () => {
    describe('Relative Path Resolution', () => {
      it('should resolve relative path against base', () => {
        expect(resolvePath('bar/baz', '/foo')).toBe('/foo/bar/baz')
      })

      it('should resolve . correctly', () => {
        expect(resolvePath('.', '/foo/bar')).toBe('/foo/bar')
      })

      it('should resolve .. correctly', () => {
        expect(resolvePath('..', '/foo/bar')).toBe('/foo')
      })

      it('should resolve complex relative paths', () => {
        expect(resolvePath('../baz', '/foo/bar')).toBe('/foo/baz')
      })

      it('should resolve multiple parent references', () => {
        expect(resolvePath('../../qux', '/foo/bar/baz')).toBe('/foo/qux')
      })

      it('should normalize redundant segments', () => {
        expect(resolvePath('./foo/../bar/./baz', '/base')).toBe('/base/bar/baz')
      })
    })

    describe('Absolute Paths', () => {
      it('should return absolute path unchanged when no base', () => {
        expect(resolvePath('/foo/bar')).toBe('/foo/bar')
      })

      it('should ignore base when path is absolute', () => {
        expect(resolvePath('/foo/bar', '/base')).toBe('/foo/bar')
      })

      it('should handle Windows absolute paths', () => {
        expect(resolvePath('C:\\foo\\bar')).toBe('/c/foo/bar')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty path', () => {
        expect(resolvePath('', '/foo')).toBe('/foo')
      })

      it('should handle empty base', () => {
        expect(resolvePath('foo/bar', '')).toBe('foo/bar')
      })

      it('should prevent traversal above root', () => {
        expect(resolvePath('../../..', '/foo')).toBe('/')
      })
    })
  })

  // ===========================================================================
  // expandPath Tests
  // ===========================================================================

  describe('expandPath', () => {
    describe('Home Directory Expansion', () => {
      it('should expand ~ to home directory', () => {
        const env = { HOME: '/home/user' }
        expect(expandPath('~', env)).toBe('/home/user')
      })

      it('should expand ~/path', () => {
        const env = { HOME: '/home/user' }
        expect(expandPath('~/Documents', env)).toBe('/home/user/Documents')
      })

      it('should expand ~/ at beginning only', () => {
        const env = { HOME: '/home/user' }
        expect(expandPath('foo/~/bar', env)).toBe('foo/~/bar')
      })

      it('should use USERPROFILE on Windows when HOME not set', () => {
        const env = { USERPROFILE: 'C:\\Users\\test' }
        expect(expandPath('~', env)).toBe('C:\\Users\\test')
      })

      it('should prefer HOME over USERPROFILE', () => {
        const env = { HOME: '/home/user', USERPROFILE: 'C:\\Users\\test' }
        expect(expandPath('~', env)).toBe('/home/user')
      })
    })

    describe('Environment Variable Expansion (Unix style)', () => {
      it('should expand $HOME', () => {
        const env = { HOME: '/home/user' }
        expect(expandPath('$HOME/Documents', env)).toBe('/home/user/Documents')
      })

      it('should expand $VAR in middle of path', () => {
        const env = { PROJECT: 'myproject' }
        expect(expandPath('/home/$PROJECT/src', env)).toBe('/home/myproject/src')
      })

      it('should expand ${VAR} syntax', () => {
        const env = { HOME: '/home/user' }
        expect(expandPath('${HOME}/Documents', env)).toBe('/home/user/Documents')
      })

      it('should expand multiple variables', () => {
        const env = { HOME: '/home/user', PROJECT: 'myproject' }
        expect(expandPath('$HOME/$PROJECT', env)).toBe('/home/user/myproject')
      })

      it('should leave unexpanded variables as-is', () => {
        expect(expandPath('$UNDEFINED/path', {})).toBe('$UNDEFINED/path')
      })
    })

    describe('Environment Variable Expansion (Windows style)', () => {
      it('should expand %USERPROFILE%', () => {
        const env = { USERPROFILE: 'C:\\Users\\test' }
        expect(expandPath('%USERPROFILE%\\Documents', env)).toBe('C:\\Users\\test\\Documents')
      })

      it('should expand %VAR% in middle of path', () => {
        const env = { PROJECT: 'myproject' }
        expect(expandPath('C:\\%PROJECT%\\src', env)).toBe('C:\\myproject\\src')
      })

      it('should expand multiple Windows variables', () => {
        const env = { USERPROFILE: 'C:\\Users\\test', PROJECT: 'myproject' }
        expect(expandPath('%USERPROFILE%\\%PROJECT%', env)).toBe('C:\\Users\\test\\myproject')
      })

      it('should leave unexpanded Windows variables as-is', () => {
        expect(expandPath('%UNDEFINED%\\path', {})).toBe('%UNDEFINED%\\path')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty string', () => {
        expect(expandPath('', {})).toBe('')
      })

      it('should handle path without variables', () => {
        expect(expandPath('/foo/bar', {})).toBe('/foo/bar')
      })

      it('should handle empty env object', () => {
        expect(expandPath('~/foo', {})).toBe('~/foo')
      })

      it('should handle adjacent variables', () => {
        const env = { A: 'foo', B: 'bar' }
        expect(expandPath('$A$B', env)).toBe('foobar')
      })
    })
  })

  // ===========================================================================
  // normalizePath Tests
  // ===========================================================================

  describe('normalizePath', () => {
    it('should remove redundant slashes', () => {
      expect(normalizePath('/foo//bar///baz')).toBe('/foo/bar/baz')
    })

    it('should resolve . segments', () => {
      expect(normalizePath('/foo/./bar/./baz')).toBe('/foo/bar/baz')
    })

    it('should resolve .. segments', () => {
      expect(normalizePath('/foo/bar/../baz')).toBe('/foo/baz')
    })

    it('should preserve trailing slash', () => {
      expect(normalizePath('/foo/bar/')).toBe('/foo/bar/')
    })

    it('should handle root path', () => {
      expect(normalizePath('/')).toBe('/')
    })

    it('should handle relative paths', () => {
      expect(normalizePath('./foo/../bar')).toBe('bar')
    })
  })

  // ===========================================================================
  // isAbsolutePath Tests
  // ===========================================================================

  describe('isAbsolutePath', () => {
    describe('Unix Paths', () => {
      it('should detect Unix absolute path', () => {
        expect(isAbsolutePath('/foo/bar')).toBe(true)
      })

      it('should detect Unix root', () => {
        expect(isAbsolutePath('/')).toBe(true)
      })

      it('should reject relative path', () => {
        expect(isAbsolutePath('foo/bar')).toBe(false)
      })

      it('should reject dot path', () => {
        expect(isAbsolutePath('./foo')).toBe(false)
      })

      it('should reject parent path', () => {
        expect(isAbsolutePath('../foo')).toBe(false)
      })
    })

    describe('Windows Paths', () => {
      it('should detect Windows absolute path with drive', () => {
        expect(isAbsolutePath('C:\\foo\\bar')).toBe(true)
      })

      it('should detect Windows path with forward slashes', () => {
        expect(isAbsolutePath('C:/foo/bar')).toBe(true)
      })

      it('should detect UNC path', () => {
        expect(isAbsolutePath('\\\\server\\share')).toBe(true)
      })

      it('should detect UNC path with forward slashes', () => {
        expect(isAbsolutePath('//server/share')).toBe(true)
      })
    })
  })

  // ===========================================================================
  // detectPlatform Tests
  // ===========================================================================

  describe('detectPlatform', () => {
    it('should detect Unix path', () => {
      expect(detectPlatform('/foo/bar')).toBe(PathPlatform.Unix)
    })

    it('should detect Windows path with drive letter', () => {
      expect(detectPlatform('C:\\foo\\bar')).toBe(PathPlatform.Windows)
    })

    it('should detect Windows UNC path', () => {
      expect(detectPlatform('\\\\server\\share')).toBe(PathPlatform.Windows)
    })

    it('should return Unix for relative paths', () => {
      expect(detectPlatform('foo/bar')).toBe(PathPlatform.Unix)
    })

    it('should detect Windows from backslashes in relative path', () => {
      expect(detectPlatform('foo\\bar')).toBe(PathPlatform.Windows)
    })
  })

  // ===========================================================================
  // Security Validation Tests
  // ===========================================================================

  describe('validatePathSecurity', () => {
    describe('Path Traversal Prevention', () => {
      it('should allow normal paths', () => {
        expect(() => validatePathSecurity('/foo/bar/baz')).not.toThrow()
      })

      it('should reject path traversal attempts', () => {
        expect(() => validatePathSecurity('/foo/../../../etc/passwd')).toThrow(PathSecurityError)
      })

      it('should reject encoded traversal attempts', () => {
        expect(() => validatePathSecurity('/foo/%2e%2e/%2e%2e/etc/passwd')).toThrow(PathSecurityError)
      })

      it('should allow safe .. within bounds', () => {
        expect(() => validatePathSecurity('/foo/bar/../baz')).not.toThrow()
      })

      it('should reject traversal above allowed root', () => {
        const options = { allowedRoot: '/home/user' }
        expect(() => validatePathSecurity('/home/user/../other', options)).toThrow(PathSecurityError)
      })

      it('should allow paths within allowed root', () => {
        const options = { allowedRoot: '/home/user' }
        expect(() => validatePathSecurity('/home/user/documents', options)).not.toThrow()
      })
    })

    describe('Null Byte Injection', () => {
      it('should reject paths with null bytes', () => {
        expect(() => validatePathSecurity('/foo/bar\x00.txt')).toThrow(PathSecurityError)
      })

      it('should reject encoded null bytes', () => {
        expect(() => validatePathSecurity('/foo/bar%00.txt')).toThrow(PathSecurityError)
      })
    })

    describe('Windows Device Names', () => {
      it('should reject CON device', () => {
        expect(() => validatePathSecurity('C:\\CON')).toThrow(PathSecurityError)
      })

      it('should reject PRN device', () => {
        expect(() => validatePathSecurity('C:\\PRN')).toThrow(PathSecurityError)
      })

      it('should reject NUL device', () => {
        expect(() => validatePathSecurity('C:\\NUL')).toThrow(PathSecurityError)
      })

      it('should reject COM1 device', () => {
        expect(() => validatePathSecurity('C:\\COM1')).toThrow(PathSecurityError)
      })

      it('should reject LPT1 device', () => {
        expect(() => validatePathSecurity('C:\\LPT1')).toThrow(PathSecurityError)
      })

      it('should reject device names with extensions', () => {
        expect(() => validatePathSecurity('C:\\CON.txt')).toThrow(PathSecurityError)
      })

      it('should reject device names case-insensitively', () => {
        expect(() => validatePathSecurity('C:\\con')).toThrow(PathSecurityError)
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty path', () => {
        expect(() => validatePathSecurity('')).not.toThrow()
      })

      it('should handle root path', () => {
        expect(() => validatePathSecurity('/')).not.toThrow()
      })

      it('should handle relative paths', () => {
        expect(() => validatePathSecurity('foo/bar')).not.toThrow()
      })
    })
  })
})
