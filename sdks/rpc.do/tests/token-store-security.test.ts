/**
 * Token Store Security Tests
 *
 * TDD tests for secure token storage:
 * - File permissions (0600 for tokens, 0700 for directory)
 * - Atomic writes (write to temp file, then rename)
 * - Descriptive error handling (no silent swallowing)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('TokenStore Security', () => {
  let tempDir: string
  let tokensPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-security-test-'))
    tokensPath = path.join(tempDir, 'tokens.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('file permissions', () => {
    it('should create tokens file with 0600 permissions (owner read/write only)', async () => {
      const { TokenStore } = await import('../auth/token-store')

      const tokenStore = new TokenStore(tokensPath)
      await tokenStore.saveTokens({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      })

      const stats = fs.statSync(tokensPath)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600) // Owner read/write only
    })

    it('should create directory with 0700 permissions (owner rwx only)', async () => {
      const { TokenStore } = await import('../auth/token-store')

      // Create a nested path to test directory creation
      const nestedDir = path.join(tempDir, 'nested', '.do')
      const nestedTokensPath = path.join(nestedDir, 'tokens.json')

      const tokenStore = new TokenStore(nestedTokensPath)
      await tokenStore.saveTokens({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      })

      const stats = fs.statSync(nestedDir)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o700) // Owner rwx only
    })

    it('should maintain 0600 permissions when updating existing tokens', async () => {
      const { TokenStore } = await import('../auth/token-store')

      const tokenStore = new TokenStore(tokensPath)

      // First save
      await tokenStore.saveTokens({
        access_token: 'first-token',
        refresh_token: 'first-refresh',
        expires_at: Date.now() + 3600000,
      })

      // Second save (update)
      await tokenStore.saveTokens({
        access_token: 'second-token',
        refresh_token: 'second-refresh',
        expires_at: Date.now() + 7200000,
      })

      const stats = fs.statSync(tokensPath)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })
  })

  describe('atomic writes', () => {
    it('should write atomically (no partial files on success)', async () => {
      const { TokenStore } = await import('../auth/token-store')

      const tokenStore = new TokenStore(tokensPath)
      await tokenStore.saveTokens({
        access_token: 'atomic-test-token',
        refresh_token: 'atomic-test-refresh',
        expires_at: Date.now() + 3600000,
      })

      // File should be complete and valid JSON
      const content = fs.readFileSync(tokensPath, 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()

      const parsed = JSON.parse(content)
      expect(parsed.access_token).toBe('atomic-test-token')
    })

    it('should not leave temp files after successful write', async () => {
      const { TokenStore } = await import('../auth/token-store')

      const tokenStore = new TokenStore(tokensPath)
      await tokenStore.saveTokens({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000,
      })

      // Check for temp files in the directory
      const files = fs.readdirSync(tempDir)
      const tempFiles = files.filter((f) => f.includes('.tmp'))
      expect(tempFiles).toHaveLength(0)
    })
  })

  describe('error handling', () => {
    it('should throw descriptive error when reading invalid JSON', async () => {
      const { TokenStore } = await import('../auth/token-store')

      // Create a file with invalid JSON
      fs.writeFileSync(tokensPath, 'not valid json {{{')

      const tokenStore = new TokenStore(tokensPath)
      await expect(tokenStore.getTokens()).rejects.toThrow(/parse|invalid|json/i)
    })

    it('should throw descriptive error when reading malformed tokens', async () => {
      const { TokenStore } = await import('../auth/token-store')

      // Create a file with valid JSON but missing required fields
      fs.writeFileSync(tokensPath, JSON.stringify({ foo: 'bar' }))

      const tokenStore = new TokenStore(tokensPath)
      await expect(tokenStore.getTokens()).rejects.toThrow(/invalid|structure|token/i)
    })

    it('should include file path in error messages', async () => {
      const { TokenStore } = await import('../auth/token-store')

      // Create a file with invalid JSON
      fs.writeFileSync(tokensPath, 'invalid')

      const tokenStore = new TokenStore(tokensPath)

      try {
        await tokenStore.getTokens()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error instanceof Error).toBe(true)
        expect((error as Error).message).toContain(tokensPath)
      }
    })

    it('should throw descriptive error when save fails due to permissions', async () => {
      const { TokenStore } = await import('../auth/token-store')

      // Skip on Windows where permission model is different
      if (process.platform === 'win32') {
        return
      }

      // Create a read-only directory
      const readOnlyDir = path.join(tempDir, 'readonly')
      fs.mkdirSync(readOnlyDir, { mode: 0o500 })
      const readOnlyPath = path.join(readOnlyDir, 'tokens.json')

      const tokenStore = new TokenStore(readOnlyPath)

      try {
        await tokenStore.saveTokens({
          access_token: 'test',
          refresh_token: 'test',
          expires_at: Date.now() + 3600000,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error instanceof Error).toBe(true)
        expect((error as Error).message).toMatch(/save|write|permission/i)
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(readOnlyDir, 0o700)
      }
    })

    it('should return null for non-existent file (not throw)', async () => {
      const { TokenStore } = await import('../auth/token-store')

      const tokenStore = new TokenStore(path.join(tempDir, 'nonexistent.json'))
      const result = await tokenStore.getTokens()

      expect(result).toBeNull()
    })
  })

  describe('token validation', () => {
    it('should validate access_token is present', async () => {
      const { TokenStore } = await import('../auth/token-store')

      fs.writeFileSync(
        tokensPath,
        JSON.stringify({
          refresh_token: 'refresh',
          expires_at: Date.now() + 3600000,
        })
      )

      const tokenStore = new TokenStore(tokensPath)
      await expect(tokenStore.getTokens()).rejects.toThrow(/invalid|access_token/i)
    })

    it('should validate refresh_token is present', async () => {
      const { TokenStore } = await import('../auth/token-store')

      fs.writeFileSync(
        tokensPath,
        JSON.stringify({
          access_token: 'access',
          expires_at: Date.now() + 3600000,
        })
      )

      const tokenStore = new TokenStore(tokensPath)
      await expect(tokenStore.getTokens()).rejects.toThrow(/invalid|refresh_token/i)
    })

    it('should validate expires_at is a number', async () => {
      const { TokenStore } = await import('../auth/token-store')

      fs.writeFileSync(
        tokensPath,
        JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: 'not a number',
        })
      )

      const tokenStore = new TokenStore(tokensPath)
      await expect(tokenStore.getTokens()).rejects.toThrow(/invalid|expires_at/i)
    })
  })
})
