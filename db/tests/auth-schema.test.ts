import { describe, it, expect } from 'vitest'
import { accounts } from '../auth'

/**
 * Auth Schema Tests
 *
 * Tests for the better-auth Drizzle schema, focusing on security-sensitive fields.
 */

describe('Auth Schema', () => {
  describe('accounts table', () => {
    describe('passwordHash field', () => {
      it('should have passwordHash field for email/password auth', () => {
        // The field should be named passwordHash to clearly indicate it stores
        // a hashed value, never plaintext passwords
        expect(accounts.passwordHash).toBeDefined()
        expect(accounts.passwordHash.name).toBe('password_hash')
      })

      it('should NOT have a field named "password" to avoid confusion', () => {
        // A field named "password" could be confused with plaintext storage
        // @ts-expect-error - password field should not exist
        expect(accounts.password).toBeUndefined()
      })

      it('passwordHash column maps to password_hash in database', () => {
        // Verify the snake_case column name
        expect(accounts.passwordHash.name).toBe('password_hash')
      })
    })
  })
})
