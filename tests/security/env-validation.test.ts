import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Environment Variable Validation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset module cache before each test
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('should throw descriptive error when GOOGLE_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID

    // The validateAuthEnv function should validate required OAuth environment variables
    // and throw a descriptive error when they are missing
    await expect(async () => {
      const { validateAuthEnv } = await import('../../auth/env-validation')
      validateAuthEnv()
    }).rejects.toThrow(/GOOGLE_CLIENT_ID.*required/i)
  })

  it('should throw descriptive error when GOOGLE_CLIENT_SECRET is missing', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET

    await expect(async () => {
      const { validateAuthEnv } = await import('../../auth/env-validation')
      validateAuthEnv()
    }).rejects.toThrow(/GOOGLE_CLIENT_SECRET.*required/i)
  })

  it('should throw descriptive error when GITHUB_CLIENT_ID is missing', async () => {
    delete process.env.GITHUB_CLIENT_ID

    await expect(async () => {
      const { validateAuthEnv } = await import('../../auth/env-validation')
      validateAuthEnv()
    }).rejects.toThrow(/GITHUB_CLIENT_ID.*required/i)
  })

  it('should throw descriptive error when GITHUB_CLIENT_SECRET is missing', async () => {
    delete process.env.GITHUB_CLIENT_SECRET

    await expect(async () => {
      const { validateAuthEnv } = await import('../../auth/env-validation')
      validateAuthEnv()
    }).rejects.toThrow(/GITHUB_CLIENT_SECRET.*required/i)
  })

  it('should not throw when all required variables are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
    process.env.GITHUB_CLIENT_ID = 'test-github-id'
    process.env.GITHUB_CLIENT_SECRET = 'test-github-secret'

    // Should succeed without throwing
    const { validateAuthEnv } = await import('../../auth/env-validation')
    expect(() => validateAuthEnv()).not.toThrow()
  })

  it('should list all missing variables in a single error message', async () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET

    await expect(async () => {
      const { validateAuthEnv } = await import('../../auth/env-validation')
      validateAuthEnv()
    }).rejects.toThrow(/missing.*environment variables/i)
  })
})
