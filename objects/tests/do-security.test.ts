/**
 * Security TDD Tests (RED Phase)
 *
 * These tests verify security fixes for vulnerabilities identified in code review:
 * - StatelessDO.ts:610 - Fake Parquet format
 * - StatelessDO.ts:387,551 - SQL injection risks
 * - StatelessDO.ts:404 - Manual string escaping
 * - Function.ts:59-97 - Race conditions
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'

describe('Security', () => {
  describe('SQL Injection Prevention', () => {
    it('should reject malicious table names', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-test'))
      // Attempt SQL injection via table name
      await expect(
        (stub as any).getTableRows('users; DROP TABLE users--')
      ).rejects.toThrow(/invalid table name/i)
    })

    it('should reject table names with special characters', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-test'))
      const maliciousNames = [
        "users'--",
        'users"--',
        'users`--',
        'users;DELETE',
        '../../../etc/passwd',
        'users\x00',
      ]
      for (const name of maliciousNames) {
        await expect(
          (stub as any).getTableRows(name)
        ).rejects.toThrow()
      }
    })

    it('should use parameterized queries for values', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-test'))
      // Values with SQL should be escaped, not executed
      const result = await (stub as any).insertRow('users', {
        name: "Robert'); DROP TABLE users;--",
        email: 'bobby@tables.com'
      })
      expect(result.success).toBe(true)
      // Table should still exist
      const tables = await (stub as any).listTables()
      expect(tables).toContain('users')
    })

    it('should validate JSON paths against injection', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-test'))
      const maliciousPaths = [
        "$.user'; DROP TABLE--",
        '$.user[0]/**/OR/**/1=1',
        '$.user\'; DELETE FROM',
      ]
      for (const path of maliciousPaths) {
        await expect(
          (stub as any).queryJsonPath(path)
        ).rejects.toThrow(/invalid.*path/i)
      }
    })

    it('should whitelist allowed table names', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-test'))
      // Only whitelisted tables should be accessible
      const whitelist = await (stub as any).getTableWhitelist()
      expect(Array.isArray(whitelist)).toBe(true)
      expect(whitelist.length).toBeGreaterThan(0)
    })
  })

  describe('Parquet Format Validation', () => {
    it('should serialize to valid Parquet format', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-parquet'))
      const data = [{ id: 1, name: 'test' }]
      const serialized = await (stub as any).serializeToParquet(data)
      // Real Parquet has specific magic bytes and structure
      const bytes = new Uint8Array(serialized)
      // PAR1 magic at start
      expect(bytes[0]).toBe(0x50) // P
      expect(bytes[1]).toBe(0x41) // A
      expect(bytes[2]).toBe(0x52) // R
      expect(bytes[3]).toBe(0x31) // 1
      // PAR1 magic at end (Parquet footer)
      expect(bytes[bytes.length - 4]).toBe(0x50)
      expect(bytes[bytes.length - 3]).toBe(0x41)
      expect(bytes[bytes.length - 2]).toBe(0x52)
      expect(bytes[bytes.length - 1]).toBe(0x31)
    })

    it('should deserialize and validate schema', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-parquet'))
      const data = [{ id: 1, name: 'test' }]
      const serialized = await (stub as any).serializeToParquet(data)
      const deserialized = await (stub as any).deserializeParquet(serialized)
      expect(deserialized).toEqual(data)
    })

    it('should reject malformed Parquet data', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-parquet'))
      const malformedData = new Uint8Array([0x00, 0x01, 0x02, 0x03])
      await expect(
        (stub as any).deserializeParquet(malformedData.buffer)
      ).rejects.toThrow(/invalid.*parquet/i)
    })

    it('should validate schema on restore', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-parquet'))
      // Try to restore with wrong schema
      await expect(
        (stub as any).restoreFromParquet({
          data: new ArrayBuffer(100),
          expectedSchema: { columns: ['id', 'name'] }
        })
      ).rejects.toThrow(/schema.*mismatch/i)
    })
  })

  describe('Race Condition Prevention', () => {
    it('should isolate concurrent function invocations', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-race'))
      // Launch 10 concurrent invocations
      const promises = Array(10).fill(null).map((_, i) =>
        (stub as any).invoke({ input: i })
      )
      const results = await Promise.all(promises)
      // Each should have unique invocation ID
      const ids = results.map(r => r.invocationId)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)
    })

    it('should use blockConcurrencyWhile for critical sections', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-race'))
      // This should block concurrent access
      const result = await (stub as any).criticalOperation()
      expect(result.usedBlockConcurrency).toBe(true)
    })

    it('should not interleave state updates', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-race'))
      // Set initial value
      await (stub as any).setState({ counter: 0 })
      // Increment 100 times concurrently
      const promises = Array(100).fill(null).map(() =>
        (stub as any).incrementCounter()
      )
      await Promise.all(promises)
      // Counter should be exactly 100
      const state = await (stub as any).getState()
      expect(state.counter).toBe(100)
    })
  })

  describe('Input Validation', () => {
    it('should reject oversized payloads', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-input'))
      const largePayload = 'x'.repeat(10 * 1024 * 1024) // 10MB
      await expect(
        (stub as any).processInput(largePayload)
      ).rejects.toThrow(/payload.*too large/i)
    })

    it('should reject invalid JSON', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-input'))
      await expect(
        (stub as any).processJson('{ invalid json }')
      ).rejects.toThrow(/invalid.*json/i)
    })

    it('should block path traversal attempts', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-input'))
      const traversalPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        '/etc/passwd',
        'file:///etc/passwd',
      ]
      for (const path of traversalPaths) {
        await expect(
          (stub as any).readFile(path)
        ).rejects.toThrow(/path.*traversal|invalid.*path/i)
      }
    })

    it('should sanitize user-provided HTML', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-input'))
      const maliciousHtml = '<script>alert("xss")</script><p>Hello</p>'
      const sanitized = await (stub as any).sanitizeHtml(maliciousHtml)
      expect(sanitized).not.toContain('<script>')
      expect(sanitized).toContain('<p>Hello</p>')
    })
  })

  describe('Authentication & Authorization', () => {
    it('should require authentication for sensitive operations', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-auth'))
      await expect(
        (stub as any).sensitiveOperation()
      ).rejects.toThrow(/unauthorized|authentication required/i)
    })

    it('should validate JWT tokens', async () => {
      const stub = env.DO.get(env.DO.idFromName('security-auth'))
      const invalidToken = 'invalid.jwt.token'
      await expect(
        (stub as any).authenticatedOperation(invalidToken)
      ).rejects.toThrow(/invalid.*token/i)
    })
  })
})
