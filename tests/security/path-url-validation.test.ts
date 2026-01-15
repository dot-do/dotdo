import { describe, it, expect } from 'vitest'
import {
  validatePath,
  validateUrl,
  sanitizePath,
  sanitizeUrl,
  isAbsolutePath,
  normalizePathSegments,
  type ValidationResult,
} from '../../lib/validation'

/**
 * Path and URL Validation Security Tests
 *
 * These tests verify that user-provided paths and URLs are properly validated
 * to prevent security issues like:
 * - Path traversal attacks (../)
 * - Null byte injection
 * - Protocol handler abuse (javascript:, file:, etc.)
 * - URL manipulation
 *
 * @see OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
 * @see OWASP URL Validation: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
 */

describe('Path Validation', () => {
  describe('validatePath', () => {
    describe('path traversal prevention', () => {
      it('should reject paths with double dot sequences', () => {
        const result = validatePath('../etc/passwd')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('traversal')
      })

      it('should reject paths with encoded traversal sequences', () => {
        // URL-encoded ..
        const result1 = validatePath('%2e%2e/etc/passwd')
        expect(result1.valid).toBe(false)

        // Double URL-encoded
        const result2 = validatePath('%252e%252e/etc/passwd')
        expect(result2.valid).toBe(false)
      })

      it('should reject paths with unicode traversal sequences', () => {
        // Unicode dots
        const result = validatePath('\u002e\u002e/etc/passwd')
        expect(result.valid).toBe(false)
      })

      it('should reject paths with backslash traversal (Windows-style)', () => {
        const result = validatePath('..\\windows\\system32')
        expect(result.valid).toBe(false)
      })

      it('should reject paths with mixed traversal patterns', () => {
        const result = validatePath('foo/../../bar')
        expect(result.valid).toBe(false)
      })

      it('should allow single dots in paths', () => {
        const result = validatePath('./current/file.txt')
        expect(result.valid).toBe(true)
      })

      it('should allow paths ending with dots', () => {
        const result = validatePath('file.txt')
        expect(result.valid).toBe(true)
      })
    })

    describe('null byte prevention', () => {
      it('should reject paths with null bytes', () => {
        const result = validatePath('file.txt\x00.jpg')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('null')
      })

      it('should reject paths with encoded null bytes', () => {
        const result = validatePath('file.txt%00.jpg')
        expect(result.valid).toBe(false)
      })
    })

    describe('control character prevention', () => {
      it('should reject paths with control characters', () => {
        const result = validatePath('file\x0d\x0a.txt')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('control')
      })

      it('should reject paths with bell character', () => {
        const result = validatePath('file\x07.txt')
        expect(result.valid).toBe(false)
      })
    })

    describe('absolute path handling', () => {
      it('should reject absolute Unix paths by default', () => {
        const result = validatePath('/etc/passwd')
        expect(result.valid).toBe(false)
        expect(result.error?.toLowerCase()).toContain('absolute')
      })

      it('should reject absolute Windows paths by default', () => {
        const result = validatePath('C:\\Windows\\System32')
        expect(result.valid).toBe(false)
      })

      it('should allow absolute paths when explicitly permitted', () => {
        const result = validatePath('/var/log/app.log', { allowAbsolute: true })
        expect(result.valid).toBe(true)
      })
    })

    describe('valid paths', () => {
      it('should accept valid relative paths', () => {
        expect(validatePath('images/photo.jpg').valid).toBe(true)
        expect(validatePath('docs/readme.md').valid).toBe(true)
        expect(validatePath('file.txt').valid).toBe(true)
      })

      it('should accept paths with numbers and hyphens', () => {
        expect(validatePath('user-123/file-2024.txt').valid).toBe(true)
      })

      it('should accept paths with underscores', () => {
        expect(validatePath('user_data/config_file.json').valid).toBe(true)
      })
    })
  })

  describe('sanitizePath', () => {
    it('should remove path traversal sequences', () => {
      expect(sanitizePath('../etc/passwd')).toBe('etc/passwd')
      expect(sanitizePath('foo/../../bar')).toBe('foo/bar')
    })

    it('should remove null bytes', () => {
      expect(sanitizePath('file\x00.txt')).toBe('file.txt')
    })

    it('should remove control characters', () => {
      expect(sanitizePath('file\x0d\x0a.txt')).toBe('file.txt')
    })

    it('should normalize multiple slashes', () => {
      expect(sanitizePath('foo//bar///baz')).toBe('foo/bar/baz')
    })
  })

  describe('normalizePathSegments', () => {
    it('should resolve relative paths within base', () => {
      const result = normalizePathSegments(['foo', 'bar', '..', 'baz'])
      expect(result).toEqual(['foo', 'baz'])
    })

    it('should prevent escaping the base directory', () => {
      const result = normalizePathSegments(['..', '..', 'etc', 'passwd'])
      expect(result).toEqual(['etc', 'passwd'])
    })

    it('should handle empty segments', () => {
      const result = normalizePathSegments(['foo', '', 'bar'])
      expect(result).toEqual(['foo', 'bar'])
    })
  })

  describe('isAbsolutePath', () => {
    it('should detect Unix absolute paths', () => {
      expect(isAbsolutePath('/etc/passwd')).toBe(true)
      expect(isAbsolutePath('/var/log/app.log')).toBe(true)
    })

    it('should detect Windows absolute paths', () => {
      expect(isAbsolutePath('C:\\Windows')).toBe(true)
      expect(isAbsolutePath('D:\\Users')).toBe(true)
    })

    it('should identify relative paths', () => {
      expect(isAbsolutePath('relative/path')).toBe(false)
      expect(isAbsolutePath('./current')).toBe(false)
    })
  })
})

describe('URL Validation', () => {
  describe('validateUrl', () => {
    describe('protocol validation', () => {
      it('should accept https URLs', () => {
        const result = validateUrl('https://example.com/path')
        expect(result.valid).toBe(true)
      })

      it('should accept http URLs', () => {
        const result = validateUrl('http://example.com/path')
        expect(result.valid).toBe(true)
      })

      it('should reject javascript: URLs', () => {
        const result = validateUrl('javascript:alert(1)')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('protocol')
      })

      it('should reject data: URLs', () => {
        const result = validateUrl('data:text/html,<script>alert(1)</script>')
        expect(result.valid).toBe(false)
      })

      it('should reject file: URLs', () => {
        const result = validateUrl('file:///etc/passwd')
        expect(result.valid).toBe(false)
      })

      it('should reject vbscript: URLs', () => {
        const result = validateUrl('vbscript:msgbox("XSS")')
        expect(result.valid).toBe(false)
      })

      it('should allow custom protocols when specified', () => {
        const result = validateUrl('wss://example.com/socket', { allowedProtocols: ['wss:'] })
        expect(result.valid).toBe(true)
      })
    })

    describe('format validation', () => {
      it('should reject invalid URL formats', () => {
        const result = validateUrl('not-a-valid-url')
        expect(result.valid).toBe(false)
        expect(result.error).toContain('format')
      })

      it('should reject URLs with spaces', () => {
        const result = validateUrl('https://example.com/path with spaces')
        expect(result.valid).toBe(false)
      })

      it('should handle URLs with encoded characters', () => {
        const result = validateUrl('https://example.com/path%20with%20spaces')
        expect(result.valid).toBe(true)
      })
    })

    describe('hostname validation', () => {
      it('should accept valid hostnames', () => {
        expect(validateUrl('https://example.com').valid).toBe(true)
        expect(validateUrl('https://sub.example.com').valid).toBe(true)
        expect(validateUrl('https://example.co.uk').valid).toBe(true)
      })

      it('should accept localhost', () => {
        expect(validateUrl('http://localhost:3000').valid).toBe(true)
        expect(validateUrl('http://localhost').valid).toBe(true)
      })

      it('should accept IP addresses', () => {
        expect(validateUrl('http://127.0.0.1:3000').valid).toBe(true)
        expect(validateUrl('http://192.168.1.1').valid).toBe(true)
      })

      it('should reject URLs without hostname', () => {
        // Note: The URL API parses 'https:///path' as hostname='path', pathname='/'
        // So we use a truly malformed URL instead
        const result = validateUrl('https://:8080/path')
        expect(result.valid).toBe(false)
      })
    })

    describe('path traversal in URLs', () => {
      it('should reject URLs with path traversal', () => {
        const result = validateUrl('https://example.com/../../../etc/passwd')
        expect(result.valid).toBe(false)
      })

      it('should reject URLs with encoded path traversal', () => {
        const result = validateUrl('https://example.com/%2e%2e/%2e%2e/etc/passwd')
        expect(result.valid).toBe(false)
      })
    })

    describe('SSRF prevention', () => {
      it('should optionally block internal IP ranges', () => {
        const result = validateUrl('http://10.0.0.1/admin', { blockInternalIPs: true })
        expect(result.valid).toBe(false)
        expect(result.error?.toLowerCase()).toContain('internal')
      })

      it('should optionally block localhost', () => {
        const result = validateUrl('http://localhost/admin', { blockInternalIPs: true })
        expect(result.valid).toBe(false)
      })

      it('should optionally block 127.x.x.x range', () => {
        const result = validateUrl('http://127.0.0.1/admin', { blockInternalIPs: true })
        expect(result.valid).toBe(false)
      })

      it('should optionally block 192.168.x.x range', () => {
        const result = validateUrl('http://192.168.1.1/admin', { blockInternalIPs: true })
        expect(result.valid).toBe(false)
      })

      it('should optionally block 172.16-31.x.x range', () => {
        const result = validateUrl('http://172.16.0.1/admin', { blockInternalIPs: true })
        expect(result.valid).toBe(false)
      })
    })

    describe('domain allowlist', () => {
      it('should validate against allowed domains when specified', () => {
        const result = validateUrl('https://evil.com/callback', {
          allowedDomains: ['example.com', 'trusted.org'],
        })
        expect(result.valid).toBe(false)
        expect(result.error?.toLowerCase()).toContain('domain')
      })

      it('should accept URLs from allowed domains', () => {
        const result = validateUrl('https://api.example.com/endpoint', {
          allowedDomains: ['example.com'],
        })
        expect(result.valid).toBe(true)
      })

      it('should match subdomains of allowed domains', () => {
        const result = validateUrl('https://sub.sub.example.com/path', {
          allowedDomains: ['example.com'],
        })
        expect(result.valid).toBe(true)
      })
    })
  })

  describe('sanitizeUrl', () => {
    it('should remove javascript: protocol', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('')
    })

    it('should preserve valid URLs', () => {
      expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path')
    })

    it('should normalize protocol to lowercase', () => {
      expect(sanitizeUrl('HTTPS://EXAMPLE.COM/path')).toBe('https://example.com/path')
    })

    it('should remove credentials from URLs', () => {
      expect(sanitizeUrl('https://user:pass@example.com/path')).toBe('https://example.com/path')
    })

    it('should strip port 80 from http URLs', () => {
      expect(sanitizeUrl('http://example.com:80/path')).toBe('http://example.com/path')
    })

    it('should strip port 443 from https URLs', () => {
      expect(sanitizeUrl('https://example.com:443/path')).toBe('https://example.com/path')
    })
  })
})

describe('Integration scenarios', () => {
  describe('file path handling', () => {
    it('should safely handle user-uploaded file paths', () => {
      const userInput = '../../../etc/passwd'
      const result = validatePath(userInput)
      expect(result.valid).toBe(false)

      // If we needed to use it, sanitize first
      const sanitized = sanitizePath(userInput)
      const sanitizedResult = validatePath(sanitized)
      expect(sanitizedResult.valid).toBe(true)
    })
  })

  describe('redirect URL handling', () => {
    it('should prevent open redirect attacks', () => {
      // Attacker provides external redirect
      const maliciousRedirect = 'https://evil-phishing-site.com/fake-login'

      const result = validateUrl(maliciousRedirect, {
        allowedDomains: ['app.dotdo.dev', 'dotdo.dev'],
      })
      expect(result.valid).toBe(false)
    })

    it('should allow same-domain redirects', () => {
      const safeRedirect = 'https://app.dotdo.dev/dashboard'

      const result = validateUrl(safeRedirect, {
        allowedDomains: ['dotdo.dev'],
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('webhook URL handling', () => {
    it('should prevent SSRF through webhook URLs', () => {
      // Attacker tries to probe internal network
      const ssrfAttempt = 'http://192.168.1.1:8080/admin'

      const result = validateUrl(ssrfAttempt, { blockInternalIPs: true })
      expect(result.valid).toBe(false)
    })
  })
})
