import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from '../server'

/**
 * Helper to check structured error response format
 */
interface ValidationErrorResponse {
  type: string
  code: string
  message: string
}

function expectValidationError(json: ValidationErrorResponse, messagePattern: string | RegExp) {
  expect(json.type).toBe('ValidationError')
  expect(json.code).toBe('VALIDATION_ERROR')
  if (typeof messagePattern === 'string') {
    expect(json.message).toContain(messagePattern)
  } else {
    expect(json.message).toMatch(messagePattern)
  }
}

describe('RPC Method Path Validation', () => {
  const testTarget = {
    greet: (name: string) => `Hello, ${name}!`,
    users: {
      create: (data: { name: string }) => ({ id: '1', ...data }),
      list: () => [{ id: '1', name: 'Alice' }],
      admin: {
        promote: (id: string) => ({ promoted: true, id })
      }
    }
  }

  let app: ReturnType<typeof createServer>

  beforeEach(() => {
    app = createServer({ target: testTarget })
  })

  describe('valid method paths', () => {
    it('should accept simple method names', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('Hello, World!')
    })

    it('should accept nested method paths with dots', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.create', args: [{ name: 'Bob' }] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: '1', name: 'Bob' })
    })

    it('should accept deeply nested method paths', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.admin.promote', args: ['user-123'] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ promoted: true, id: 'user-123' })
    })

    it('should accept method names with underscores', async () => {
      const targetWithUnderscores = {
        get_user: () => ({ id: '1' }),
        user_service: {
          create_user: () => ({ created: true })
        }
      }
      const appWithUnderscores = createServer({ target: targetWithUnderscores })

      const res = await appWithUnderscores.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'get_user', args: [] })
      })

      expect(res.status).toBe(200)
    })

    it('should accept method names with numbers', async () => {
      const targetWithNumbers = {
        v2: {
          getUser: () => ({ id: '1' })
        }
      }
      const appWithNumbers = createServer({ target: targetWithNumbers })

      const res = await appWithNumbers.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'v2.getUser', args: [] })
      })

      expect(res.status).toBe(200)
    })
  })

  describe('invalid method paths should be rejected', () => {
    it('should reject empty method name', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with only dots', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '...', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method starting with dot', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '.greet', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method ending with dot', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet.', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with consecutive dots', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users..create', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject non-string method', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 123, args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject missing method field', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })
  })

  describe('prototype pollution and path traversal attempts should be blocked', () => {
    it('should reject __proto__ access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '__proto__', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject __proto__ in nested path', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.__proto__.polluted', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject constructor access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'constructor', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject constructor in nested path', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.constructor.name', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject prototype access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'prototype', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject __defineGetter__ access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '__defineGetter__', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject __defineSetter__ access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '__defineSetter__', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject __lookupGetter__ access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '__lookupGetter__', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject __lookupSetter__ access', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '__lookupSetter__', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })
  })

  describe('special characters should be handled', () => {
    it('should reject method with slashes (path traversal)', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: '../../../etc/passwd', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with backslashes', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users\\admin', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with brackets', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users[0]', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with parentheses', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users()', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with semicolons', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users;drop', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with spaces', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users create', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with null bytes', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users\x00admin', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should reject method with unicode control characters', async () => {
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users\u200Badmin', args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })
  })

  describe('method path length limits', () => {
    it('should reject excessively long method paths', async () => {
      const longMethod = 'a'.repeat(1001)
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: longMethod, args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })

    it('should accept reasonable length method paths', async () => {
      // This should work - it's a normal method on the target
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
    })

    it('should reject deeply nested paths beyond reasonable depth', async () => {
      const deepPath = Array(101).fill('a').join('.')
      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: deepPath, args: [] })
      })

      expect(res.status).toBe(400)
      const json = await res.json()
      expectValidationError(json, 'Invalid method path')
    })
  })
})
