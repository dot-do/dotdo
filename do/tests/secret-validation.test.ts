import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, MissingSecretsError, type DOEnv, type SecretValidationConfig } from '../DO'

// Mock DurableObjectState
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id' } as DurableObjectId,
    storage: {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        storage.delete(key)
        return Promise.resolve(true)
      }),
      list: vi.fn(() => Promise.resolve(storage)),
      deleteAll: vi.fn(() => {
        storage.clear()
        return Promise.resolve()
      }),
    },
    blockConcurrencyWhile: vi.fn((fn) => fn()),
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState
}

describe('DO Secret Validation (do-pj71)', () => {
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
  })

  describe('MissingSecretsError', () => {
    it('should include missing secrets in error message', () => {
      const error = new MissingSecretsError(['JWT_SECRET', 'API_KEY'])
      expect(error.message).toContain('JWT_SECRET')
      expect(error.message).toContain('API_KEY')
      expect(error.missingSecrets).toEqual(['JWT_SECRET', 'API_KEY'])
      expect(error.name).toBe('MissingSecretsError')
    })
  })

  describe('constructor validation', () => {
    it('should not validate when secretValidation is not provided', () => {
      const env: DOEnv = {}
      // Should not throw
      const doInstance = new DO(mockState, env)
      expect(doInstance).toBeDefined()
    })

    it('should not validate when skipValidation is true', () => {
      const env: DOEnv = {}
      const doInstance = new DO(mockState, env, {
        secretValidation: {
          requireAuth: true,
          requireInternalSecret: true,
          skipValidation: true,
        },
      })
      expect(doInstance).toBeDefined()
    })

    it('should throw when requireAuth is true but no auth secret is provided', () => {
      const env: DOEnv = {}
      expect(() => {
        new DO(mockState, env, {
          secretValidation: { requireAuth: true },
        })
      }).toThrow(MissingSecretsError)
    })

    it('should not throw when JWT_SECRET is provided', () => {
      const env: DOEnv = {
        JWT_SECRET: 'a-very-long-secret-key-that-is-at-least-32-chars',
      }
      const doInstance = new DO(mockState, env, {
        secretValidation: { requireAuth: true },
      })
      expect(doInstance).toBeDefined()
    })

    it('should not throw when JWKS_URL is provided instead of JWT_SECRET', () => {
      const env: DOEnv = {
        JWKS_URL: 'https://example.com/.well-known/jwks.json',
      }
      const doInstance = new DO(mockState, env, {
        secretValidation: { requireAuth: true },
      })
      expect(doInstance).toBeDefined()
    })

    it('should throw when requireInternalSecret is true but secret is missing', () => {
      const env: DOEnv = {}
      expect(() => {
        new DO(mockState, env, {
          secretValidation: { requireInternalSecret: true },
        })
      }).toThrow(MissingSecretsError)
    })

    it('should not throw when DO_INTERNAL_SECRET is provided', () => {
      const env: DOEnv = {
        DO_INTERNAL_SECRET: 'a-very-long-internal-secret-that-is-at-least-32-chars',
      }
      const doInstance = new DO(mockState, env, {
        secretValidation: { requireInternalSecret: true },
      })
      expect(doInstance).toBeDefined()
    })

    it('should validate custom required environment variables', () => {
      const env: DOEnv = {}
      expect(() => {
        new DO(mockState, env, {
          secretValidation: {
            requiredEnvVars: ['CUSTOM_API_KEY', 'STRIPE_SECRET'],
          },
        })
      }).toThrow(MissingSecretsError)

      try {
        new DO(mockState, env, {
          secretValidation: {
            requiredEnvVars: ['CUSTOM_API_KEY', 'STRIPE_SECRET'],
          },
        })
      } catch (e) {
        expect(e).toBeInstanceOf(MissingSecretsError)
        expect((e as MissingSecretsError).missingSecrets).toContain('CUSTOM_API_KEY')
        expect((e as MissingSecretsError).missingSecrets).toContain('STRIPE_SECRET')
      }
    })

    it('should pass when all custom variables are provided', () => {
      const env: DOEnv = {
        CUSTOM_API_KEY: 'some-api-key',
        STRIPE_SECRET: 'sk_test_123',
      }
      const doInstance = new DO(mockState, env, {
        secretValidation: {
          requiredEnvVars: ['CUSTOM_API_KEY', 'STRIPE_SECRET'],
        },
      })
      expect(doInstance).toBeDefined()
    })

    it('should combine multiple validation requirements', () => {
      const env: DOEnv = {}
      expect(() => {
        new DO(mockState, env, {
          secretValidation: {
            requireAuth: true,
            requireInternalSecret: true,
            requiredEnvVars: ['API_KEY'],
          },
        })
      }).toThrow(MissingSecretsError)

      try {
        new DO(mockState, env, {
          secretValidation: {
            requireAuth: true,
            requireInternalSecret: true,
            requiredEnvVars: ['API_KEY'],
          },
        })
      } catch (e) {
        expect(e).toBeInstanceOf(MissingSecretsError)
        const missing = (e as MissingSecretsError).missingSecrets
        expect(missing).toContain('JWT_SECRET or JWKS_URL')
        expect(missing).toContain('DO_INTERNAL_SECRET')
        expect(missing).toContain('API_KEY')
      }
    })

    it('should treat empty strings as missing', () => {
      const env: DOEnv = {
        JWT_SECRET: '',
        DO_INTERNAL_SECRET: '',
        CUSTOM_VAR: '',
      }
      expect(() => {
        new DO(mockState, env, {
          secretValidation: {
            requireAuth: true,
            requireInternalSecret: true,
            requiredEnvVars: ['CUSTOM_VAR'],
          },
        })
      }).toThrow(MissingSecretsError)
    })
  })

  describe('static validateSecrets', () => {
    it('should return valid result when all secrets are present', () => {
      const env: DOEnv = {
        JWT_SECRET: 'a-very-long-secret-key-that-is-at-least-32-chars',
        DO_INTERNAL_SECRET: 'another-very-long-secret-key-at-least-32-chars',
      }
      const config: SecretValidationConfig = {
        requireAuth: true,
        requireInternalSecret: true,
      }

      const result = DO.validateSecrets(env, config)

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it('should return invalid result with missing secrets', () => {
      const env: DOEnv = {}
      const config: SecretValidationConfig = {
        requireAuth: true,
        requireInternalSecret: true,
      }

      const result = DO.validateSecrets(env, config)

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('JWT_SECRET or JWKS_URL')
      expect(result.missing).toContain('DO_INTERNAL_SECRET')
    })

    it('should warn about weak JWT_SECRET', () => {
      const env: DOEnv = {
        JWT_SECRET: 'short', // Less than 32 chars
      }
      const config: SecretValidationConfig = {
        requireAuth: true,
      }

      const result = DO.validateSecrets(env, config)

      expect(result.warnings).toContain('JWT_SECRET should be at least 32 characters for security')
    })

    it('should warn about weak DO_INTERNAL_SECRET', () => {
      const env: DOEnv = {
        DO_INTERNAL_SECRET: 'short', // Less than 32 chars
      }
      const config: SecretValidationConfig = {
        requireInternalSecret: true,
      }

      const result = DO.validateSecrets(env, config)

      expect(result.warnings).toContain('DO_INTERNAL_SECRET should be at least 32 characters for security')
    })

    it('should skip validation when skipValidation is true', () => {
      const env: DOEnv = {}
      const config: SecretValidationConfig = {
        requireAuth: true,
        skipValidation: true,
      }

      const result = DO.validateSecrets(env, config)

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })
  })

  describe('subclass usage pattern', () => {
    it('should allow subclasses to extend validation', () => {
      class MyDO extends DO {
        constructor(state: DurableObjectState, env: DOEnv) {
          super(state, env, {
            secretValidation: {
              requireAuth: true,
              requireInternalSecret: true,
              requiredEnvVars: ['MY_CUSTOM_SECRET'],
            },
          })
        }
      }

      const env: DOEnv = {
        JWT_SECRET: 'a-very-long-secret-key-that-is-at-least-32-chars',
        DO_INTERNAL_SECRET: 'another-very-long-secret-key-at-least-32-chars',
        MY_CUSTOM_SECRET: 'my-custom-value',
      }

      const doInstance = new MyDO(mockState, env)
      expect(doInstance).toBeDefined()
    })

    it('should fail for subclass with missing secrets', () => {
      class MyDO extends DO {
        constructor(state: DurableObjectState, env: DOEnv) {
          super(state, env, {
            secretValidation: {
              requiredEnvVars: ['REQUIRED_VAR'],
            },
          })
        }
      }

      expect(() => {
        new MyDO(mockState, {})
      }).toThrow(MissingSecretsError)
    })
  })
})
