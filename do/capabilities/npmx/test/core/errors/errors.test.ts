/**
 * Tests for structured NPM error types
 *
 * TDD RED phase: These tests define expected behavior
 */

import { describe, it, expect } from 'vitest'
import {
  NpmError,
  NpmErrorCode,
  NpmErrorContext,
  NpmErrorJSON,
  PackageNotFoundError,
  FetchError,
  InstallError,
  ExecError,
  SecurityError,
  ValidationError,
  TimeoutError,
  ResolutionError,
  TarballError,
  ParseError,
  isNpmError,
  hasErrorCode,
  wrapError,
} from '../../../core/errors'

describe('NpmError', () => {
  describe('basic properties', () => {
    it('should have a code property', () => {
      const error = new NpmError('ENOTFOUND', 'Package not found')
      expect(error.code).toBe('ENOTFOUND')
    })

    it('should have typed error codes', () => {
      // TypeScript should enforce these are valid codes
      const codes: NpmErrorCode[] = [
        'ENOTFOUND',
        'EFETCH',
        'EINSTALL',
        'EEXEC',
        'ESECURITY',
        'EVALIDATION',
        'ETIMEOUT',
        'ERESOLUTION',
        'ETARBALL',
        'EPARSE',
      ]

      for (const code of codes) {
        const error = new NpmError(code, 'Test message')
        expect(error.code).toBe(code)
      }
    })

    it('should have a message property', () => {
      const error = new NpmError('EFETCH', 'Network error')
      expect(error.message).toBe('Network error')
    })

    it('should have an optional context property', () => {
      const context: NpmErrorContext = {
        package: 'lodash',
        version: '4.17.21',
      }
      const error = new NpmError('ENOTFOUND', 'Not found', context)
      expect(error.context).toEqual(context)
    })

    it('should have name property set to NpmError', () => {
      const error = new NpmError('EFETCH', 'Error')
      expect(error.name).toBe('NpmError')
    })
  })

  describe('instanceof checks', () => {
    it('should work with instanceof NpmError', () => {
      const error = new NpmError('ENOTFOUND', 'Not found')
      expect(error).toBeInstanceOf(NpmError)
    })

    it('should work with instanceof Error', () => {
      const error = new NpmError('EFETCH', 'Fetch failed')
      expect(error).toBeInstanceOf(Error)
    })

    it('should work in try/catch', () => {
      let caught: unknown
      try {
        throw new NpmError('EINSTALL', 'Install failed')
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(NpmError)
      expect((caught as NpmError).code).toBe('EINSTALL')
    })
  })

  describe('JSON serialization', () => {
    it('should serialize to JSON', () => {
      const error = new NpmError('ENOTFOUND', 'Package not found', {
        package: 'lodash',
        version: '4.17.21',
      })

      const json = error.toJSON()

      expect(json.name).toBe('NpmError')
      expect(json.code).toBe('ENOTFOUND')
      expect(json.message).toBe('Package not found')
      expect(json.context).toEqual({ package: 'lodash', version: '4.17.21' })
      expect(json.stack).toBeDefined()
    })

    it('should be JSON.stringify-able', () => {
      const error = new NpmError('EFETCH', 'Network error')
      const str = JSON.stringify(error)
      const parsed = JSON.parse(str)

      expect(parsed.code).toBe('EFETCH')
      expect(parsed.message).toBe('Network error')
    })

    it('should deserialize from JSON', () => {
      const json: NpmErrorJSON = {
        name: 'NpmError',
        code: 'EINSTALL',
        message: 'Install failed',
        context: { package: 'react' },
      }

      const error = NpmError.fromJSON(json)

      expect(error).toBeInstanceOf(NpmError)
      expect(error.code).toBe('EINSTALL')
      expect(error.message).toBe('Install failed')
      expect(error.context).toEqual({ package: 'react' })
    })

    it('should preserve stack trace in serialization', () => {
      const error = new NpmError('EEXEC', 'Exec failed')
      const json = error.toJSON()
      const restored = NpmError.fromJSON(json)

      expect(restored.stack).toBe(json.stack)
    })
  })
})

describe('Specific Error Classes', () => {
  describe('PackageNotFoundError', () => {
    it('should have ENOTFOUND code', () => {
      const error = new PackageNotFoundError('lodash')
      expect(error.code).toBe('ENOTFOUND')
    })

    it('should include package name in message', () => {
      const error = new PackageNotFoundError('lodash')
      expect(error.message).toContain('lodash')
    })

    it('should include version in message when provided', () => {
      const error = new PackageNotFoundError('lodash', '999.0.0')
      expect(error.message).toContain('lodash@999.0.0')
    })

    it('should store package in context', () => {
      const error = new PackageNotFoundError('lodash', '4.17.21')
      expect(error.context?.package).toBe('lodash')
      expect(error.context?.version).toBe('4.17.21')
    })

    it('should be instanceof NpmError', () => {
      const error = new PackageNotFoundError('lodash')
      expect(error).toBeInstanceOf(NpmError)
      expect(error).toBeInstanceOf(PackageNotFoundError)
    })
  })

  describe('FetchError', () => {
    it('should have EFETCH code', () => {
      const error = new FetchError('Network error')
      expect(error.code).toBe('EFETCH')
    })

    it('should store HTTP status', () => {
      const error = new FetchError('Not found', { status: 404 })
      expect(error.status).toBe(404)
    })

    it('should store registry in context', () => {
      const error = new FetchError('Timeout', { registry: 'https://registry.npmjs.org' })
      expect(error.context?.registry).toBe('https://registry.npmjs.org')
    })
  })

  describe('InstallError', () => {
    it('should have EINSTALL code', () => {
      const error = new InstallError('Installation failed')
      expect(error.code).toBe('EINSTALL')
    })

    it('should store package name in context', () => {
      const error = new InstallError('Failed to install', 'react')
      expect(error.context?.package).toBe('react')
    })
  })

  describe('ExecError', () => {
    it('should have EEXEC code', () => {
      const error = new ExecError('Command failed')
      expect(error.code).toBe('EEXEC')
    })

    it('should store exit code', () => {
      const error = new ExecError('Failed', { exitCode: 1 })
      expect(error.exitCode).toBe(1)
    })

    it('should store package in context', () => {
      const error = new ExecError('cowsay failed', { package: 'cowsay' })
      expect(error.context?.package).toBe('cowsay')
    })
  })

  describe('SecurityError', () => {
    it('should have ESECURITY code', () => {
      const error = new SecurityError('Package blocked')
      expect(error.code).toBe('ESECURITY')
    })

    it('should store severity', () => {
      const error = new SecurityError('Critical vulnerability', { severity: 'critical' })
      expect(error.severity).toBe('critical')
    })

    it('should store package in context', () => {
      const error = new SecurityError('Blocked', { package: 'malicious-pkg' })
      expect(error.context?.package).toBe('malicious-pkg')
    })
  })

  describe('ValidationError', () => {
    it('should have EVALIDATION code', () => {
      const error = new ValidationError('Invalid input')
      expect(error.code).toBe('EVALIDATION')
    })

    it('should accept context', () => {
      const error = new ValidationError('Invalid version', { version: 'not-semver' })
      expect(error.context?.version).toBe('not-semver')
    })
  })

  describe('TimeoutError', () => {
    it('should have ETIMEOUT code', () => {
      const error = new TimeoutError('Operation timed out')
      expect(error.code).toBe('ETIMEOUT')
    })

    it('should store timeout duration', () => {
      const error = new TimeoutError('Timed out after 30s', 30000)
      expect(error.timeoutMs).toBe(30000)
    })
  })

  describe('ResolutionError', () => {
    it('should have ERESOLUTION code', () => {
      const error = new ResolutionError('Could not resolve')
      expect(error.code).toBe('ERESOLUTION')
    })

    it('should store package and version in context', () => {
      const error = new ResolutionError('No matching version', 'lodash', '^999.0.0')
      expect(error.context?.package).toBe('lodash')
      expect(error.context?.version).toBe('^999.0.0')
    })
  })

  describe('TarballError', () => {
    it('should have ETARBALL code', () => {
      const error = new TarballError('Extraction failed')
      expect(error.code).toBe('ETARBALL')
    })

    it('should store package in context', () => {
      const error = new TarballError('Invalid tarball', 'corrupted-pkg')
      expect(error.context?.package).toBe('corrupted-pkg')
    })
  })

  describe('ParseError', () => {
    it('should have EPARSE code', () => {
      const error = new ParseError('Invalid JSON')
      expect(error.code).toBe('EPARSE')
    })

    it('should accept context', () => {
      const error = new ParseError('Invalid package.json', { path: '/package.json' })
      expect(error.context?.path).toBe('/package.json')
    })
  })
})

describe('Type Guards', () => {
  describe('isNpmError', () => {
    it('should return true for NpmError instances', () => {
      const error = new NpmError('EFETCH', 'Error')
      expect(isNpmError(error)).toBe(true)
    })

    it('should return true for specific error subclasses', () => {
      expect(isNpmError(new PackageNotFoundError('pkg'))).toBe(true)
      expect(isNpmError(new FetchError('error'))).toBe(true)
      expect(isNpmError(new SecurityError('blocked'))).toBe(true)
    })

    it('should return false for plain Error', () => {
      expect(isNpmError(new Error('plain error'))).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(isNpmError('string')).toBe(false)
      expect(isNpmError(null)).toBe(false)
      expect(isNpmError(undefined)).toBe(false)
      expect(isNpmError({ code: 'EFETCH' })).toBe(false)
    })
  })

  describe('hasErrorCode', () => {
    it('should return true when error has matching code', () => {
      const error = new NpmError('ENOTFOUND', 'Not found')
      expect(hasErrorCode(error, 'ENOTFOUND')).toBe(true)
    })

    it('should return false when error has different code', () => {
      const error = new NpmError('EFETCH', 'Fetch failed')
      expect(hasErrorCode(error, 'ENOTFOUND')).toBe(false)
    })

    it('should return false for non-NpmError', () => {
      expect(hasErrorCode(new Error('plain'), 'EFETCH')).toBe(false)
      expect(hasErrorCode(null, 'EFETCH')).toBe(false)
    })
  })
})

describe('Error Utilities', () => {
  describe('wrapError', () => {
    it('should return NpmError unchanged', () => {
      const original = new NpmError('EFETCH', 'Error')
      const wrapped = wrapError(original)
      expect(wrapped).toBe(original)
    })

    it('should wrap plain Error', () => {
      const original = new Error('Plain error')
      const wrapped = wrapError(original, 'EVALIDATION')

      expect(wrapped).toBeInstanceOf(NpmError)
      expect(wrapped.code).toBe('EVALIDATION')
      expect(wrapped.message).toBe('Plain error')
    })

    it('should wrap string errors', () => {
      const wrapped = wrapError('String error', 'EFETCH')

      expect(wrapped).toBeInstanceOf(NpmError)
      expect(wrapped.code).toBe('EFETCH')
      expect(wrapped.message).toBe('String error')
    })

    it('should default to EVALIDATION code', () => {
      const wrapped = wrapError(new Error('Error'))
      expect(wrapped.code).toBe('EVALIDATION')
    })
  })
})

describe('Error Code Completeness', () => {
  it('all error codes should have corresponding error classes', () => {
    // This test documents that all codes have a purpose
    const codeToClass: Record<NpmErrorCode, new (...args: any[]) => NpmError> = {
      ENOTFOUND: PackageNotFoundError,
      EFETCH: FetchError,
      EINSTALL: InstallError,
      EEXEC: ExecError,
      ESECURITY: SecurityError,
      EVALIDATION: ValidationError,
      ETIMEOUT: TimeoutError,
      ERESOLUTION: ResolutionError,
      ETARBALL: TarballError,
      EPARSE: ParseError,
    }

    for (const [code, ErrorClass] of Object.entries(codeToClass)) {
      const instance = code === 'ENOTFOUND'
        ? new ErrorClass('pkg')
        : new ErrorClass('message')
      expect(instance.code).toBe(code)
    }
  })
})
