import { describe, it, expect } from 'vitest'
import { extractToken } from '../token'

describe('Cookie URL Encoding', () => {
  describe('extractToken with URL-encoded cookie values', () => {
    it('should decode URL-encoded spaces (%20) in cookie values', () => {
      // Cookie value with URL-encoded space: "token%20value" -> "token value"
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=token%20value' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns "token%20value" instead of "token value"
      expect(result).toBe('token value')
    })

    it('should decode URL-encoded equals signs (%3D) in cookie values', () => {
      // JWT tokens contain base64 which may have = padding that gets encoded
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ%3D%3D' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns encoded value instead of decoded
      expect(result).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ==')
    })

    it('should decode URL-encoded plus signs (%2B) in cookie values', () => {
      // Base64 can contain + characters
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=abc%2Bdef%2Bghi' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns encoded value instead of decoded
      expect(result).toBe('abc+def+ghi')
    })

    it('should decode URL-encoded slashes (%2F) in cookie values', () => {
      // Base64 can contain / characters
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=abc%2Fdef%2Fghi' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns encoded value instead of decoded
      expect(result).toBe('abc/def/ghi')
    })

    it('should handle multiple URL-encoded characters in a single value', () => {
      // Complex case with multiple encodings
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=hello%20world%3D%3Dfoo%2Bbar' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns raw encoded string
      expect(result).toBe('hello world==foo+bar')
    })

    it('should handle non-encoded values without modification', () => {
      // Normal JWT token without any encoding - should work as-is
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123'
      const result = extractToken(
        {
          headers: new Headers({ Cookie: `auth_token=${token}` }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // This should already pass
      expect(result).toBe(token)
    })

    it('should decode URL-encoded semicolons (%3B) in cookie values', () => {
      // Semicolons in values would need encoding since ; separates cookies
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=value%3Bwith%3Bsemicolons' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns encoded value instead of decoded
      expect(result).toBe('value;with;semicolons')
    })

    it('should decode URL-encoded percent signs (%25) in cookie values', () => {
      // To represent a literal %, it must be encoded as %25
      const result = extractToken(
        {
          headers: new Headers({ Cookie: 'auth_token=100%2525complete' }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      // Currently fails: returns encoded value instead of decoded
      expect(result).toBe('100%25complete')
    })
  })
})
