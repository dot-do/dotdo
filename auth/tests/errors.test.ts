import { describe, it, expect } from 'vitest'
import {
  TokenErrorCode,
  TokenValidationError,
  MissingTokenError,
  InvalidAuthHeaderError,
  MalformedTokenError,
  InvalidSignatureError,
  TokenExpiredError,
  TokenNotYetValidError,
  InvalidIssuerError,
  InvalidAudienceError,
  MissingSubjectError,
  AlgorithmNotAllowedError,
  AlgorithmNotSupportedError,
  ClaimValidationError,
  mapJoseError,
  getWWWAuthenticateHeader,
} from '../errors'

describe('Token Validation Errors', () => {
  describe('TokenValidationError', () => {
    it('should create error with code and message', () => {
      const error = new TokenValidationError(
        'Test error',
        TokenErrorCode.VALIDATION_FAILED
      )

      expect(error.message).toBe('Test error')
      expect(error.code).toBe(TokenErrorCode.VALIDATION_FAILED)
      expect(error.statusCode).toBe(401)
      expect(error.name).toBe('TokenValidationError')
    })

    it('should support custom status code', () => {
      const error = new TokenValidationError(
        'Forbidden',
        TokenErrorCode.VALIDATION_FAILED,
        { statusCode: 403 }
      )

      expect(error.statusCode).toBe(403)
    })

    it('should support hint for debugging', () => {
      const error = new TokenValidationError(
        'Test error',
        TokenErrorCode.VALIDATION_FAILED,
        { hint: 'Try refreshing the token' }
      )

      expect(error.hint).toBe('Try refreshing the token')
    })

    it('should serialize to JSON safely', () => {
      const error = new TokenValidationError(
        'Test error',
        TokenErrorCode.VALIDATION_FAILED,
        { hint: 'Debug hint' }
      )

      const json = error.toJSON()
      expect(json).toEqual({
        error: 'TokenValidationError',
        code: TokenErrorCode.VALIDATION_FAILED,
        message: 'Test error',
        hint: 'Debug hint',
      })
    })
  })

  describe('MissingTokenError', () => {
    it('should create error for missing header token', () => {
      const error = new MissingTokenError('header')

      expect(error.message).toBe('Authorization header required')
      expect(error.code).toBe(TokenErrorCode.MISSING_TOKEN)
      expect(error.hint).toContain('Authorization header')
    })

    it('should create error for missing cookie token', () => {
      const error = new MissingTokenError('cookie')

      expect(error.message).toBe('Authentication cookie required')
      expect(error.code).toBe(TokenErrorCode.MISSING_TOKEN)
    })

    it('should create error for missing both', () => {
      const error = new MissingTokenError('both')

      expect(error.message).toContain('Bearer token or auth cookie')
    })
  })

  describe('InvalidAuthHeaderError', () => {
    it('should handle missing scheme', () => {
      const error = new InvalidAuthHeaderError('missing_scheme')

      expect(error.message).toContain('missing authentication scheme')
      expect(error.code).toBe(TokenErrorCode.INVALID_AUTH_HEADER)
    })

    it('should handle wrong scheme', () => {
      const error = new InvalidAuthHeaderError('wrong_scheme')

      expect(error.message).toContain('Expected "Bearer"')
      expect(error.hint).toContain('Bearer')
    })

    it('should handle missing token', () => {
      const error = new InvalidAuthHeaderError('missing_token')

      expect(error.message).toContain('missing token value')
    })
  })

  describe('MalformedTokenError', () => {
    it('should create error with default message', () => {
      const error = new MalformedTokenError()

      expect(error.message).toContain('malformed')
      expect(error.code).toBe(TokenErrorCode.MALFORMED_TOKEN)
    })

    it('should include specific reason when provided', () => {
      const error = new MalformedTokenError('invalid base64 encoding')

      expect(error.message).toContain('invalid base64 encoding')
    })
  })

  describe('InvalidSignatureError', () => {
    it('should create signature error', () => {
      const error = new InvalidSignatureError()

      expect(error.message).toContain('signature verification failed')
      expect(error.code).toBe(TokenErrorCode.INVALID_SIGNATURE)
      expect(error.hint).toContain('correct secret')
    })
  })

  describe('TokenExpiredError', () => {
    it('should create error without expiration time', () => {
      const error = new TokenExpiredError()

      expect(error.message).toBe('Token has expired')
      expect(error.code).toBe(TokenErrorCode.TOKEN_EXPIRED)
    })

    it('should include expiration time when provided', () => {
      const expiredAt = Math.floor(Date.now() / 1000) - 3600
      const error = new TokenExpiredError(expiredAt)

      expect(error.message).toContain('Token expired at')
      expect(error.expiredAt).toBe(expiredAt)
    })

    it('should include expiredAt in JSON', () => {
      const expiredAt = Math.floor(Date.now() / 1000) - 3600
      const error = new TokenExpiredError(expiredAt)

      const json = error.toJSON()
      expect(json.expiredAt).toBe(expiredAt)
    })
  })

  describe('TokenNotYetValidError', () => {
    it('should create error without valid-from time', () => {
      const error = new TokenNotYetValidError()

      expect(error.message).toBe('Token is not yet valid')
      expect(error.code).toBe(TokenErrorCode.TOKEN_NOT_YET_VALID)
    })

    it('should include valid-from time when provided', () => {
      const validFrom = Math.floor(Date.now() / 1000) + 3600
      const error = new TokenNotYetValidError(validFrom)

      expect(error.message).toContain('not valid until')
      expect(error.validFrom).toBe(validFrom)
    })
  })

  describe('InvalidIssuerError', () => {
    it('should create error without expected issuer', () => {
      const error = new InvalidIssuerError()

      expect(error.message).toContain('issuer (iss) is invalid')
      expect(error.code).toBe(TokenErrorCode.INVALID_ISSUER)
    })

    it('should include expected issuer when provided', () => {
      const error = new InvalidIssuerError('id.org.ai')

      expect(error.message).toContain('does not match expected value "id.org.ai"')
    })
  })

  describe('InvalidAudienceError', () => {
    it('should create error without expected audience', () => {
      const error = new InvalidAudienceError()

      expect(error.message).toContain('audience (aud) is invalid')
      expect(error.code).toBe(TokenErrorCode.INVALID_AUDIENCE)
    })

    it('should include expected audience when provided', () => {
      const error = new InvalidAudienceError('dotdo.api')

      expect(error.message).toContain('does not match expected value "dotdo.api"')
    })
  })

  describe('MissingSubjectError', () => {
    it('should create error for missing subject claim', () => {
      const error = new MissingSubjectError()

      expect(error.message).toContain('missing required subject (sub) claim')
      expect(error.code).toBe(TokenErrorCode.MISSING_SUBJECT)
    })
  })

  describe('AlgorithmNotAllowedError', () => {
    it('should create error without algorithm', () => {
      const error = new AlgorithmNotAllowedError()

      expect(error.message).toContain('algorithm is not allowed')
      expect(error.code).toBe(TokenErrorCode.ALGORITHM_NOT_ALLOWED)
    })

    it('should include algorithm when provided', () => {
      const error = new AlgorithmNotAllowedError('none')

      expect(error.message).toContain('"none" is not allowed')
    })
  })

  describe('AlgorithmNotSupportedError', () => {
    it('should create error without algorithm', () => {
      const error = new AlgorithmNotSupportedError()

      expect(error.message).toContain('algorithm is not supported')
      expect(error.code).toBe(TokenErrorCode.ALGORITHM_NOT_SUPPORTED)
    })

    it('should include algorithm when provided', () => {
      const error = new AlgorithmNotSupportedError('PS512')

      expect(error.message).toContain('"PS512" is not supported')
    })
  })

  describe('ClaimValidationError', () => {
    it('should create error for claim without reason', () => {
      const error = new ClaimValidationError('custom_claim')

      expect(error.message).toContain('"custom_claim" validation failed')
      expect(error.code).toBe(TokenErrorCode.CLAIM_VALIDATION_FAILED)
      expect(error.claim).toBe('custom_claim')
    })

    it('should include reason when provided', () => {
      const error = new ClaimValidationError('exp', 'timestamp is in the past')

      expect(error.message).toContain('timestamp is in the past')
      expect(error.reason).toBe('timestamp is in the past')
    })

    it('should include claim and reason in JSON', () => {
      const error = new ClaimValidationError('iat', 'invalid timestamp')

      const json = error.toJSON()
      expect(json.claim).toBe('iat')
      expect(json.reason).toBe('invalid timestamp')
    })
  })

  describe('mapJoseError', () => {
    it('should pass through TokenValidationError unchanged', () => {
      const original = new TokenExpiredError()
      const mapped = mapJoseError(original)

      expect(mapped).toBe(original)
    })

    it('should map expired token errors', () => {
      const joseError = new Error('"exp" claim timestamp check failed')
      ;(joseError as any).code = 'ERR_JWT_EXPIRED'
      ;(joseError as any).payload = { exp: 1234567890 }

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(TokenExpiredError)
      expect((mapped as TokenExpiredError).expiredAt).toBe(1234567890)
    })

    it('should map signature verification errors', () => {
      const joseError = new Error('signature verification failed')
      ;(joseError as any).code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(InvalidSignatureError)
    })

    it('should map invalid JWT errors', () => {
      const joseError = new Error('Invalid Compact JWS')
      ;(joseError as any).code = 'ERR_JWT_INVALID'

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(MalformedTokenError)
    })

    it('should map algorithm not allowed errors', () => {
      const joseError = new Error('alg not allowed')
      ;(joseError as any).code = 'ERR_JOSE_ALG_NOT_ALLOWED'

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(AlgorithmNotAllowedError)
    })

    it('should map claim validation errors with issuer', () => {
      const joseError = new Error('unexpected "iss" claim value')
      ;(joseError as any).code = 'ERR_JWT_CLAIM_VALIDATION_FAILED'
      ;(joseError as any).claim = 'iss'

      const mapped = mapJoseError(joseError, { expectedIssuer: 'id.org.ai' })

      expect(mapped).toBeInstanceOf(InvalidIssuerError)
      expect(mapped.message).toContain('id.org.ai')
    })

    it('should map claim validation errors with audience', () => {
      const joseError = new Error('unexpected "aud" claim value')
      ;(joseError as any).code = 'ERR_JWT_CLAIM_VALIDATION_FAILED'
      ;(joseError as any).claim = 'aud'

      const mapped = mapJoseError(joseError, { expectedAudience: 'dotdo.api' })

      expect(mapped).toBeInstanceOf(InvalidAudienceError)
      expect(mapped.message).toContain('dotdo.api')
    })

    it('should map errors by message when no code is present', () => {
      const joseError = new Error('signature verification failed')

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(InvalidSignatureError)
    })

    it('should create generic error for unknown errors', () => {
      const joseError = new Error('Something unexpected happened')

      const mapped = mapJoseError(joseError)

      expect(mapped).toBeInstanceOf(TokenValidationError)
      expect(mapped.code).toBe(TokenErrorCode.VALIDATION_FAILED)
    })

    it('should handle non-Error objects', () => {
      const mapped = mapJoseError('string error')

      expect(mapped).toBeInstanceOf(TokenValidationError)
      expect(mapped.code).toBe(TokenErrorCode.VALIDATION_FAILED)
    })
  })

  describe('getWWWAuthenticateHeader', () => {
    it('should generate valid WWW-Authenticate header for missing token', () => {
      const error = new MissingTokenError('header')
      const header = getWWWAuthenticateHeader(error)

      expect(header).toContain('Bearer realm="dotdo"')
      expect(header).toContain('error="invalid_request"')
      expect(header).toContain('error_description=')
      expect(header).toContain('error_code="TOKEN_MISSING"')
    })

    it('should generate valid WWW-Authenticate header for expired token', () => {
      const error = new TokenExpiredError()
      const header = getWWWAuthenticateHeader(error)

      expect(header).toContain('Bearer realm="dotdo"')
      expect(header).toContain('error="invalid_token"')
      expect(header).toContain('error_code="TOKEN_EXPIRED"')
    })

    it('should support custom realm', () => {
      const error = new InvalidSignatureError()
      const header = getWWWAuthenticateHeader(error, 'my-api')

      expect(header).toContain('Bearer realm="my-api"')
    })

    it('should escape quotes in error description', () => {
      const error = new TokenValidationError(
        'Token contains "special" characters',
        TokenErrorCode.VALIDATION_FAILED
      )
      const header = getWWWAuthenticateHeader(error)

      // Should escape the quotes
      expect(header).toContain('error_description="Token contains \\"special\\" characters"')
    })
  })
})
