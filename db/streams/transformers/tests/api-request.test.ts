import { describe, it, expect, beforeAll } from 'vitest'

/**
 * API Request Analytics Transformer Tests
 *
 * These tests verify the transformation of API request/response analytics
 * to the unified event schema.
 *
 * This is RED phase TDD - tests should FAIL until the transformer
 * is implemented in db/streams/transformers/api-request.ts.
 *
 * The transformer maps:
 * - method -> http_method
 * - url -> http_url, http_host, http_path, http_query
 * - status -> http_status
 * - status -> outcome (2xx=success, 4xx=client_error, 5xx=server_error)
 * - requestSize -> http_request_size
 * - responseSize -> http_response_size
 * - duration -> duration_ms
 * - ttfb -> snippet_ttfb (reuse column)
 * - protocol -> http_protocol
 * - cache status -> snippet_cache_state (reuse column)
 * - Sets event_type to 'trace'
 * - Sets event_name to '{method} {path}'
 */

import type { UnifiedEvent } from '../../../../types/unified-event'

// ============================================================================
// Input Interface (Expected)
// ============================================================================

interface ApiRequestEvent {
  method: string
  url: string
  status: number
  requestSize?: number
  responseSize?: number
  duration: number
  ttfb?: number
  protocol?: string
  cache?: 'HIT' | 'MISS' | 'BYPASS' | 'STALE'
  requestId?: string
  timestamp?: Date
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformApiRequest: ((req: ApiRequestEvent, ns: string) => UnifiedEvent) | undefined
let statusToOutcome: ((status: number) => string) | undefined

beforeAll(async () => {
  try {
    const module = await import('../api-request')
    transformApiRequest = module.transformApiRequest
    statusToOutcome = module.statusToOutcome
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
    // Tests will fail with clear messages about what's missing
  }
})

// ============================================================================
// Function Export Tests
// ============================================================================

describe('API Request Transformer Exports', () => {
  it('transformApiRequest is exported from db/streams/transformers/api-request.ts', () => {
    expect(
      transformApiRequest,
      'transformApiRequest should be exported from db/streams/transformers/api-request.ts'
    ).toBeDefined()
    expect(typeof transformApiRequest).toBe('function')
  })

  it('statusToOutcome is exported from db/streams/transformers/api-request.ts', () => {
    expect(
      statusToOutcome,
      'statusToOutcome should be exported from db/streams/transformers/api-request.ts'
    ).toBeDefined()
    expect(typeof statusToOutcome).toBe('function')
  })
})

// ============================================================================
// HTTP Method Mapping Tests
// ============================================================================

describe('HTTP Method Mapping', () => {
  it('maps method to http_method', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_method).toBe('GET')
  })

  it('preserves POST method', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 201,
      duration: 150,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_method).toBe('POST')
  })

  it('preserves PUT method', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'PUT',
      url: 'https://api.example.com/users/123',
      status: 200,
      duration: 120,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_method).toBe('PUT')
  })

  it('preserves DELETE method', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'DELETE',
      url: 'https://api.example.com/users/123',
      status: 204,
      duration: 80,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_method).toBe('DELETE')
  })
})

// ============================================================================
// URL Mapping Tests
// ============================================================================

describe('URL Mapping', () => {
  it('maps url to http_url', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users?page=1',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_url).toBe('https://api.example.com/users?page=1')
  })

  it('extracts http_host from url', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com:8080/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_host).toBe('api.example.com:8080')
  })

  it('extracts http_path from url', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users/123/profile',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_path).toBe('/users/123/profile')
  })

  it('extracts http_query from url with query string', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users?page=1&limit=10',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_query).toBe('?page=1&limit=10')
  })

  it('sets http_query to null when no query string', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_query).toBeNull()
  })
})

// ============================================================================
// Status Mapping Tests
// ============================================================================

describe('Status Mapping', () => {
  it('maps status to http_status', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_status).toBe(200)
  })

  it('maps 201 status correctly', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 201,
      duration: 150,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_status).toBe(201)
  })

  it('maps 404 status correctly', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users/notfound',
      status: 404,
      duration: 50,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_status).toBe(404)
  })

  it('maps 500 status correctly', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/error',
      status: 500,
      duration: 200,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_status).toBe(500)
  })
})

// ============================================================================
// Outcome Mapping Tests
// ============================================================================

describe('Outcome Mapping (statusToOutcome)', () => {
  describe('2xx -> success', () => {
    it('maps 200 to success', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(200)).toBe('success')
    })

    it('maps 201 to success', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(201)).toBe('success')
    })

    it('maps 204 to success', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(204)).toBe('success')
    })

    it('maps 299 to success', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(299)).toBe('success')
    })
  })

  describe('4xx -> client_error', () => {
    it('maps 400 to client_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(400)).toBe('client_error')
    })

    it('maps 401 to client_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(401)).toBe('client_error')
    })

    it('maps 403 to client_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(403)).toBe('client_error')
    })

    it('maps 404 to client_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(404)).toBe('client_error')
    })

    it('maps 499 to client_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(499)).toBe('client_error')
    })
  })

  describe('5xx -> server_error', () => {
    it('maps 500 to server_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(500)).toBe('server_error')
    })

    it('maps 502 to server_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(502)).toBe('server_error')
    })

    it('maps 503 to server_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(503)).toBe('server_error')
    })

    it('maps 599 to server_error', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(599)).toBe('server_error')
    })
  })

  describe('Other status codes -> unknown', () => {
    it('maps 100 to unknown', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(100)).toBe('unknown')
    })

    it('maps 301 to unknown', () => {
      expect(statusToOutcome).toBeDefined()
      expect(statusToOutcome!(301)).toBe('unknown')
    })
  })

  describe('Outcome in transformed event', () => {
    it('sets outcome based on status', () => {
      expect(transformApiRequest).toBeDefined()

      const req: ApiRequestEvent = {
        method: 'GET',
        url: 'https://api.example.com/users',
        status: 200,
        duration: 100,
      }

      const result = transformApiRequest!(req, 'test-ns')
      expect(result.outcome).toBe('success')
    })

    it('sets outcome to client_error for 404', () => {
      expect(transformApiRequest).toBeDefined()

      const req: ApiRequestEvent = {
        method: 'GET',
        url: 'https://api.example.com/users/notfound',
        status: 404,
        duration: 50,
      }

      const result = transformApiRequest!(req, 'test-ns')
      expect(result.outcome).toBe('client_error')
    })

    it('sets outcome to server_error for 500', () => {
      expect(transformApiRequest).toBeDefined()

      const req: ApiRequestEvent = {
        method: 'POST',
        url: 'https://api.example.com/error',
        status: 500,
        duration: 200,
      }

      const result = transformApiRequest!(req, 'test-ns')
      expect(result.outcome).toBe('server_error')
    })
  })
})

// ============================================================================
// Size Mapping Tests
// ============================================================================

describe('Size Mapping', () => {
  it('maps requestSize to http_request_size', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 201,
      duration: 150,
      requestSize: 1024,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_request_size).toBe(1024)
  })

  it('maps responseSize to http_response_size', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      responseSize: 2048,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_response_size).toBe(2048)
  })

  it('sets http_request_size to null when not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_request_size).toBeNull()
  })

  it('sets http_response_size to null when not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_response_size).toBeNull()
  })
})

// ============================================================================
// Duration Mapping Tests
// ============================================================================

describe('Duration Mapping', () => {
  it('maps duration to duration_ms', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 150,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.duration_ms).toBe(150)
  })

  it('handles sub-millisecond duration', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/health',
      status: 200,
      duration: 0.5,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.duration_ms).toBe(0.5)
  })
})

// ============================================================================
// TTFB Mapping Tests
// ============================================================================

describe('TTFB Mapping', () => {
  it('maps ttfb to snippet_ttfb (column reuse)', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 150,
      ttfb: 50,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_ttfb).toBe(50)
  })

  it('sets snippet_ttfb to null when not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_ttfb).toBeNull()
  })
})

// ============================================================================
// Protocol Mapping Tests
// ============================================================================

describe('Protocol Mapping', () => {
  it('maps protocol to http_protocol', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      protocol: 'HTTP/2',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_protocol).toBe('HTTP/2')
  })

  it('handles HTTP/1.1 protocol', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      protocol: 'HTTP/1.1',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_protocol).toBe('HTTP/1.1')
  })

  it('sets http_protocol to null when not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.http_protocol).toBeNull()
  })
})

// ============================================================================
// Cache Status Mapping Tests
// ============================================================================

describe('Cache Status Mapping', () => {
  it('maps cache HIT to snippet_cache_state (column reuse)', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 10,
      cache: 'HIT',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_cache_state).toBe('hit')
  })

  it('maps cache MISS to lowercase', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      cache: 'MISS',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_cache_state).toBe('miss')
  })

  it('maps cache BYPASS to lowercase', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 201,
      duration: 150,
      cache: 'BYPASS',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_cache_state).toBe('bypass')
  })

  it('maps cache STALE to lowercase', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 20,
      cache: 'STALE',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_cache_state).toBe('stale')
  })

  it('sets snippet_cache_state to null when not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.snippet_cache_state).toBeNull()
  })
})

// ============================================================================
// Event Type Tests
// ============================================================================

describe('Event Type', () => {
  it('sets event_type to "trace"', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.event_type).toBe('trace')
  })
})

// ============================================================================
// Event Name Tests
// ============================================================================

describe('Event Name', () => {
  it('sets event_name to "{method} {path}"', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.event_name).toBe('GET /users')
  })

  it('includes full path in event_name', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users/123/profile',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.event_name).toBe('POST /users/123/profile')
  })

  it('handles root path', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/',
      status: 200,
      duration: 50,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.event_name).toBe('GET /')
  })
})

// ============================================================================
// Namespace Mapping Tests
// ============================================================================

describe('Namespace Mapping', () => {
  it('sets ns from parameter', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'my-namespace')
    expect(result.ns).toBe('my-namespace')
  })
})

// ============================================================================
// Correlation ID Tests
// ============================================================================

describe('Correlation ID', () => {
  it('maps requestId to correlation_id', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      requestId: 'req-abc123',
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.correlation_id).toBe('req-abc123')
  })

  it('sets correlation_id to null when requestId not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.correlation_id).toBeNull()
  })
})

// ============================================================================
// ID Generation Tests
// ============================================================================

describe('ID Generation', () => {
  it('generates a unique id', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.id).toBeDefined()
    expect(typeof result.id).toBe('string')
    expect(result.id.length).toBeGreaterThan(0)
  })

  it('generates unique ids for different events', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result1 = transformApiRequest!(req, 'test-ns')
    const result2 = transformApiRequest!(req, 'test-ns')

    expect(result1.id).not.toBe(result2.id)
  })
})

// ============================================================================
// Status Code Mapping Tests
// ============================================================================

describe('Status Code Field', () => {
  it('sets status_code from status', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.status_code).toBe(200)
  })
})

// ============================================================================
// Timestamp Tests
// ============================================================================

describe('Timestamp', () => {
  it('uses provided timestamp', () => {
    expect(transformApiRequest).toBeDefined()

    const timestamp = new Date('2024-01-15T10:30:00Z')
    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
      timestamp,
    }

    const result = transformApiRequest!(req, 'test-ns')
    expect(result.timestamp).toBe(timestamp.toISOString())
  })

  it('uses current time when timestamp not provided', () => {
    expect(transformApiRequest).toBeDefined()

    const before = new Date()
    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      duration: 100,
    }

    const result = transformApiRequest!(req, 'test-ns')
    const after = new Date()

    const resultTime = new Date(result.timestamp!)
    expect(resultTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(resultTime.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ============================================================================
// Complete Event Transformation Tests
// ============================================================================

describe('Complete Event Transformation', () => {
  it('transforms complete API request to UnifiedEvent', () => {
    expect(transformApiRequest).toBeDefined()

    const timestamp = new Date('2024-01-15T10:30:00Z')
    const req: ApiRequestEvent = {
      method: 'POST',
      url: 'https://api.example.com/users?source=web',
      status: 201,
      requestSize: 1024,
      responseSize: 2048,
      duration: 150,
      ttfb: 50,
      protocol: 'HTTP/2',
      cache: 'BYPASS',
      requestId: 'req-xyz789',
      timestamp,
    }

    const result = transformApiRequest!(req, 'production')

    // Core identity
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('trace')
    expect(result.event_name).toBe('POST /users')
    expect(result.ns).toBe('production')

    // HTTP context
    expect(result.http_method).toBe('POST')
    expect(result.http_url).toBe('https://api.example.com/users?source=web')
    expect(result.http_host).toBe('api.example.com')
    expect(result.http_path).toBe('/users')
    expect(result.http_query).toBe('?source=web')
    expect(result.http_status).toBe(201)
    expect(result.http_protocol).toBe('HTTP/2')
    expect(result.http_request_size).toBe(1024)
    expect(result.http_response_size).toBe(2048)

    // Outcome
    expect(result.outcome).toBe('success')
    expect(result.status_code).toBe(201)

    // Timing
    expect(result.duration_ms).toBe(150)
    expect(result.snippet_ttfb).toBe(50)

    // Cache
    expect(result.snippet_cache_state).toBe('bypass')

    // Correlation
    expect(result.correlation_id).toBe('req-xyz789')

    // Timestamp
    expect(result.timestamp).toBe(timestamp.toISOString())
  })

  it('handles minimal API request', () => {
    expect(transformApiRequest).toBeDefined()

    const req: ApiRequestEvent = {
      method: 'GET',
      url: 'https://api.example.com/health',
      status: 200,
      duration: 5,
    }

    const result = transformApiRequest!(req, 'test')

    // Required fields are set
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('trace')
    expect(result.event_name).toBe('GET /health')
    expect(result.ns).toBe('test')
    expect(result.http_method).toBe('GET')
    expect(result.http_status).toBe(200)
    expect(result.duration_ms).toBe(5)
    expect(result.outcome).toBe('success')

    // Optional fields are null
    expect(result.http_request_size).toBeNull()
    expect(result.http_response_size).toBeNull()
    expect(result.snippet_ttfb).toBeNull()
    expect(result.http_protocol).toBeNull()
    expect(result.snippet_cache_state).toBeNull()
    expect(result.correlation_id).toBeNull()
  })
})
