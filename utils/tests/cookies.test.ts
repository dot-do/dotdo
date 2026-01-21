import { describe, it, expect } from 'vitest'
import { parseCookies, getCookie } from '../cookies'

describe('parseCookies', () => {
  it('should parse a single cookie', () => {
    const result = parseCookies('session=abc123')
    expect(result).toEqual({ session: 'abc123' })
  })

  it('should parse multiple cookies', () => {
    const result = parseCookies('session=abc123; auth_token=xyz789')
    expect(result).toEqual({ session: 'abc123', auth_token: 'xyz789' })
  })

  it('should handle values containing equals signs', () => {
    const result = parseCookies('token=base64==value; other=simple')
    expect(result).toEqual({ token: 'base64==value', other: 'simple' })
  })

  it('should trim whitespace from names and values', () => {
    const result = parseCookies('  session  =  abc123  ;  token  =  xyz  ')
    expect(result).toEqual({ session: 'abc123', token: 'xyz' })
  })

  it('should handle empty string', () => {
    const result = parseCookies('')
    expect(result).toEqual({})
  })

  it('should ignore cookies without values', () => {
    const result = parseCookies('session=abc; invalid; other=xyz')
    expect(result).toEqual({ session: 'abc', other: 'xyz' })
  })

  it('should handle URL-encoded values', () => {
    const result = parseCookies('data=hello%20world; session=test')
    expect(result).toEqual({ data: 'hello%20world', session: 'test' })
  })
})

describe('getCookie', () => {
  it('should return null for null header', () => {
    const result = getCookie(null, 'session')
    expect(result).toBeNull()
  })

  it('should return null for missing cookie', () => {
    const result = getCookie('session=abc', 'token')
    expect(result).toBeNull()
  })

  it('should return the cookie value', () => {
    const result = getCookie('session=abc123; auth_token=xyz789', 'auth_token')
    expect(result).toBe('xyz789')
  })

  it('should handle values with equals signs', () => {
    const result = getCookie('token=base64==value', 'token')
    expect(result).toBe('base64==value')
  })

  it('should trim whitespace', () => {
    const result = getCookie('  session  =  abc123  ', 'session')
    expect(result).toBe('abc123')
  })

  it('should match exact cookie name', () => {
    const result = getCookie('session_id=wrong; session=correct', 'session')
    expect(result).toBe('correct')
  })
})
