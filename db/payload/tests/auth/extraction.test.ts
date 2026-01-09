import { describe, it, expect } from 'vitest'
import {
  extractSessionFromCookie,
  extractBearerToken,
  extractApiKey,
  extractCredentials,
} from '../../auth/extraction'

describe('Token Extraction', () => {
  describe('extractSessionFromCookie', () => {
    it('should extract session token from cookie header', () => {
      const headers = new Headers({ cookie: 'better-auth.session_token=abc123; other=value' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBe('abc123')
    })

    it('should return null if no session cookie present', () => {
      const headers = new Headers({ cookie: 'other=value' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBeNull()
    })

    it('should handle missing cookie header', () => {
      const headers = new Headers()
      const token = extractSessionFromCookie(headers)
      expect(token).toBeNull()
    })

    it('should handle URL-encoded session token', () => {
      const headers = new Headers({ cookie: 'better-auth.session_token=abc%20123; other=value' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBe('abc 123')
    })

    it('should handle session token with special characters', () => {
      const headers = new Headers({ cookie: 'better-auth.session_token=abc+def=ghi; other=value' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBe('abc+def=ghi')
    })

    it('should extract token when session cookie is at end', () => {
      const headers = new Headers({ cookie: 'other=value; better-auth.session_token=xyz789' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBe('xyz789')
    })

    it('should extract token when session cookie is only cookie', () => {
      const headers = new Headers({ cookie: 'better-auth.session_token=solo123' })
      const token = extractSessionFromCookie(headers)
      expect(token).toBe('solo123')
    })
  })

  describe('extractBearerToken', () => {
    it('should extract token from Authorization header', () => {
      const headers = new Headers({ authorization: 'Bearer xyz789' })
      const token = extractBearerToken(headers)
      expect(token).toBe('xyz789')
    })

    it('should return null for non-Bearer auth', () => {
      const headers = new Headers({ authorization: 'Basic abc123' })
      const token = extractBearerToken(headers)
      expect(token).toBeNull()
    })

    it('should return null for missing Authorization header', () => {
      const headers = new Headers()
      const token = extractBearerToken(headers)
      expect(token).toBeNull()
    })

    it('should handle case-insensitive Bearer prefix', () => {
      const headers = new Headers({ authorization: 'bearer lowercase123' })
      const token = extractBearerToken(headers)
      expect(token).toBe('lowercase123')
    })

    it('should handle BEARER uppercase prefix', () => {
      const headers = new Headers({ authorization: 'BEARER UPPERCASE456' })
      const token = extractBearerToken(headers)
      expect(token).toBe('UPPERCASE456')
    })

    it('should return null for empty Bearer token', () => {
      const headers = new Headers({ authorization: 'Bearer ' })
      const token = extractBearerToken(headers)
      expect(token).toBeNull()
    })

    it('should return null for Bearer only (no space)', () => {
      const headers = new Headers({ authorization: 'Bearer' })
      const token = extractBearerToken(headers)
      expect(token).toBeNull()
    })

    it('should handle token with spaces preserved after Bearer prefix', () => {
      const headers = new Headers({ authorization: 'Bearer token with spaces' })
      const token = extractBearerToken(headers)
      expect(token).toBe('token with spaces')
    })
  })

  describe('extractApiKey', () => {
    it('should extract API key from X-API-Key header', () => {
      const headers = new Headers({ 'x-api-key': 'key_abc123' })
      const key = extractApiKey(headers)
      expect(key).toBe('key_abc123')
    })

    it('should return null for missing X-API-Key header', () => {
      const headers = new Headers()
      const key = extractApiKey(headers)
      expect(key).toBeNull()
    })

    it('should handle case-insensitive header name', () => {
      const headers = new Headers({ 'X-Api-Key': 'key_mixed456' })
      const key = extractApiKey(headers)
      expect(key).toBe('key_mixed456')
    })

    it('should return null for empty API key', () => {
      const headers = new Headers({ 'x-api-key': '' })
      const key = extractApiKey(headers)
      expect(key).toBeNull()
    })

    it('should preserve API key with special characters', () => {
      const headers = new Headers({ 'x-api-key': 'sk_live_abc123+def/ghi=' })
      const key = extractApiKey(headers)
      expect(key).toBe('sk_live_abc123+def/ghi=')
    })
  })

  describe('extractCredentials', () => {
    it('should try all extraction methods in order', () => {
      // Should try session cookie first, then bearer, then API key
      const headers = new Headers()
      const credentials = extractCredentials(headers)
      expect(credentials).toBeNull()
    })

    it('should return first successful extraction (session cookie)', () => {
      // If cookie present, use that even if bearer also present
      const headers = new Headers({
        cookie: 'better-auth.session_token=cookie_token',
        authorization: 'Bearer bearer_token',
        'x-api-key': 'api_key_token',
      })
      const credentials = extractCredentials(headers)
      expect(credentials).toEqual({
        type: 'session',
        token: 'cookie_token',
      })
    })

    it('should fall back to bearer token if no session cookie', () => {
      const headers = new Headers({
        authorization: 'Bearer bearer_token',
        'x-api-key': 'api_key_token',
      })
      const credentials = extractCredentials(headers)
      expect(credentials).toEqual({
        type: 'bearer',
        token: 'bearer_token',
      })
    })

    it('should fall back to API key if no session or bearer', () => {
      const headers = new Headers({
        'x-api-key': 'api_key_token',
      })
      const credentials = extractCredentials(headers)
      expect(credentials).toEqual({
        type: 'apiKey',
        token: 'api_key_token',
      })
    })

    it('should return null if no credentials found', () => {
      const headers = new Headers({
        'content-type': 'application/json',
      })
      const credentials = extractCredentials(headers)
      expect(credentials).toBeNull()
    })

    it('should skip invalid bearer and use API key', () => {
      const headers = new Headers({
        authorization: 'Basic not_bearer',
        'x-api-key': 'fallback_key',
      })
      const credentials = extractCredentials(headers)
      expect(credentials).toEqual({
        type: 'apiKey',
        token: 'fallback_key',
      })
    })
  })
})
