import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * Web Vitals Transformer Tests
 *
 * Tests the transformation of web-vitals library metrics to the unified event schema.
 * The web-vitals library (https://github.com/GoogleChrome/web-vitals) emits metrics
 * in a specific format that must be mapped to our UnifiedEvent schema.
 *
 * This is RED phase TDD - tests should FAIL until the transformer is implemented.
 *
 * Web Vitals metrics:
 * - LCP (Largest Contentful Paint) - timing vital, ms
 * - FID (First Input Delay) - timing vital, ms
 * - CLS (Cumulative Layout Shift) - non-timing vital, unitless score
 * - TTFB (Time to First Byte) - timing vital, ms
 * - INP (Interaction to Next Paint) - timing vital, ms
 * - FCP (First Contentful Paint) - timing vital, ms
 */

// ============================================================================
// Types (Expected Input Interface from web-vitals library)
// ============================================================================

interface WebVitalMetric {
  name: 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'INP' | 'FCP'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  id: string
  navigationType: 'navigate' | 'reload' | 'back_forward' | 'prerender'
  entries: PerformanceEntry[]
}

interface TransformContext {
  pageUrl: string
  sessionId?: string
  ns: string
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformWebVital:
  | ((vital: WebVitalMetric, context: TransformContext) => unknown)
  | undefined

beforeAll(async () => {
  try {
    const module = await import('../web-vital')
    transformWebVital = module.transformWebVital
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
  }
})

// ============================================================================
// Helper to create mock PerformanceEntry with element
// ============================================================================

function createMockLCPEntry(element: { tagName: string }): PerformanceEntry {
  return {
    name: 'largest-contentful-paint',
    entryType: 'largest-contentful-paint',
    startTime: 1234,
    duration: 0,
    toJSON: () => ({}),
    // LCP entries have an element property
    element,
  } as unknown as PerformanceEntry
}

function createMockEntry(): PerformanceEntry {
  return {
    name: 'first-input',
    entryType: 'first-input',
    startTime: 500,
    duration: 100,
    toJSON: () => ({}),
  }
}

// ============================================================================
// Transform Function Export Tests
// ============================================================================

describe('Transform Function Export', () => {
  it('transformWebVital function is exported', () => {
    expect(
      transformWebVital,
      'transformWebVital should be exported from db/streams/transformers/web-vital.ts'
    ).toBeDefined()
    expect(typeof transformWebVital).toBe('function')
  })
})

// ============================================================================
// Core Field Mapping Tests
// ============================================================================

describe('Core Field Mappings', () => {
  describe('1. Maps name to vital_name', () => {
    const vitalNames = ['LCP', 'FID', 'CLS', 'TTFB', 'INP', 'FCP'] as const

    vitalNames.forEach((vitalName) => {
      it(`maps name="${vitalName}" to vital_name="${vitalName}"`, () => {
        expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

        const vital: WebVitalMetric = {
          name: vitalName,
          value: 100,
          rating: 'good',
          delta: 50,
          id: 'v1-123',
          navigationType: 'navigate',
          entries: [],
        }

        const result = transformWebVital!(vital, {
          pageUrl: 'https://example.com',
          ns: 'test-ns',
        })

        expect(result).toHaveProperty('vital_name', vitalName)
      })
    })
  })

  describe('2. Maps value to vital_value', () => {
    it('maps numeric value to vital_value', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500.5,
        rating: 'good',
        delta: 100,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_value', 2500.5)
    })

    it('preserves decimal precision', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'CLS',
        value: 0.123456,
        rating: 'good',
        delta: 0.01,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_value', 0.123456)
    })
  })

  describe('3. Maps value to duration_ms for timing vitals', () => {
    const timingVitals = ['LCP', 'FID', 'TTFB', 'INP', 'FCP'] as const

    timingVitals.forEach((vitalName) => {
      it(`sets duration_ms for timing vital ${vitalName}`, () => {
        expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

        const vital: WebVitalMetric = {
          name: vitalName,
          value: 1500,
          rating: 'good',
          delta: 100,
          id: 'v1-123',
          navigationType: 'navigate',
          entries: [],
        }

        const result = transformWebVital!(vital, {
          pageUrl: 'https://example.com',
          ns: 'test-ns',
        })

        expect(result).toHaveProperty('duration_ms', 1500)
      })
    })

    it('does NOT set duration_ms for CLS (non-timing vital)', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'CLS',
        value: 0.15,
        rating: 'needs-improvement',
        delta: 0.05,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('duration_ms', null)
    })
  })

  describe('4. Maps rating to vital_rating', () => {
    const ratings = ['good', 'needs-improvement', 'poor'] as const

    ratings.forEach((rating) => {
      it(`maps rating="${rating}" to vital_rating="${rating}"`, () => {
        expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

        const vital: WebVitalMetric = {
          name: 'LCP',
          value: 2500,
          rating,
          delta: 100,
          id: 'v1-123',
          navigationType: 'navigate',
          entries: [],
        }

        const result = transformWebVital!(vital, {
          pageUrl: 'https://example.com',
          ns: 'test-ns',
        })

        expect(result).toHaveProperty('vital_rating', rating)
      })
    })
  })

  describe('5. Maps delta to vital_delta', () => {
    it('maps delta value to vital_delta', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'CLS',
        value: 0.15,
        rating: 'good',
        delta: 0.05,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_delta', 0.05)
    })

    it('handles zero delta', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 0,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_delta', 0)
    })
  })

  describe('6. Maps id to span_id', () => {
    it('maps web-vitals id to span_id', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 100,
        id: 'v3-1705329045123-4567890123456789',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('span_id', 'v3-1705329045123-4567890123456789')
    })
  })

  describe('7. Maps entries[0].element to vital_element for LCP', () => {
    it('extracts element tagName from LCP entry', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 100,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [createMockLCPEntry({ tagName: 'IMG' })],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_element', 'IMG')
    })

    it('returns null when entries array is empty', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 100,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_element', null)
    })

    it('returns null when entry has no element property', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'FID',
        value: 100,
        rating: 'good',
        delta: 50,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [createMockEntry()],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('vital_element', null)
    })
  })

  describe('8. Maps navigationType to nav_type', () => {
    const navTypes = ['navigate', 'reload', 'back_forward', 'prerender'] as const

    navTypes.forEach((navType) => {
      it(`maps navigationType="${navType}" to nav_type="${navType}"`, () => {
        expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

        const vital: WebVitalMetric = {
          name: 'LCP',
          value: 2500,
          rating: 'good',
          delta: 100,
          id: 'v1-123',
          navigationType: navType,
          entries: [],
        }

        const result = transformWebVital!(vital, {
          pageUrl: 'https://example.com',
          ns: 'test-ns',
        })

        expect(result).toHaveProperty('nav_type', navType)
      })
    })
  })

  describe('9. Maps page URL to page_url and http_url', () => {
    it('sets page_url from context', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 100,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com/products/123',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('http_url', 'https://example.com/products/123')
    })

    it('handles URLs with query strings', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'TTFB',
        value: 500,
        rating: 'good',
        delta: 50,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com/search?q=test&page=1',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('http_url', 'https://example.com/search?q=test&page=1')
    })
  })
})

// ============================================================================
// Event Type and Name Tests
// ============================================================================

describe('Event Type and Name', () => {
  describe('10. Sets event_type to "vital"', () => {
    it('event_type is always "vital"', () => {
      expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

      const vital: WebVitalMetric = {
        name: 'LCP',
        value: 2500,
        rating: 'good',
        delta: 100,
        id: 'v1-123',
        navigationType: 'navigate',
        entries: [],
      }

      const result = transformWebVital!(vital, {
        pageUrl: 'https://example.com',
        ns: 'test-ns',
      })

      expect(result).toHaveProperty('event_type', 'vital')
    })
  })

  describe('11. Sets event_name to vital name', () => {
    const vitalNames = ['LCP', 'FID', 'CLS', 'TTFB', 'INP', 'FCP'] as const

    vitalNames.forEach((vitalName) => {
      it(`event_name is "${vitalName}" for ${vitalName} vital`, () => {
        expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

        const vital: WebVitalMetric = {
          name: vitalName,
          value: 100,
          rating: 'good',
          delta: 50,
          id: 'v1-123',
          navigationType: 'navigate',
          entries: [],
        }

        const result = transformWebVital!(vital, {
          pageUrl: 'https://example.com',
          ns: 'test-ns',
        })

        expect(result).toHaveProperty('event_name', vitalName)
      })
    })
  })
})

// ============================================================================
// Context Field Tests
// ============================================================================

describe('Context Fields', () => {
  it('sets ns from context', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com',
      ns: 'my-namespace',
    })

    expect(result).toHaveProperty('ns', 'my-namespace')
  })

  it('sets session_id from context when provided', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com',
      ns: 'test-ns',
      sessionId: 'session-abc-123',
    })

    expect(result).toHaveProperty('session_id', 'session-abc-123')
  })

  it('sets session_id to null when not provided', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com',
      ns: 'test-ns',
    })

    expect(result).toHaveProperty('session_id', null)
  })
})

// ============================================================================
// Generated Fields Tests
// ============================================================================

describe('Generated Fields', () => {
  it('generates unique id for each event', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const context = {
      pageUrl: 'https://example.com',
      ns: 'test-ns',
    }

    const result1 = transformWebVital!(vital, context)
    const result2 = transformWebVital!(vital, context)

    expect(result1).toHaveProperty('id')
    expect(result2).toHaveProperty('id')
    expect((result1 as { id: string }).id).not.toBe((result2 as { id: string }).id)
  })

  it('generates valid UUID format for id', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com',
      ns: 'test-ns',
    })

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    expect((result as { id: string }).id).toMatch(uuidRegex)
  })

  it('sets timestamp to current time', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 100,
      id: 'v1-123',
      navigationType: 'navigate',
      entries: [],
    }

    const before = new Date()
    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com',
      ns: 'test-ns',
    })
    const after = new Date()

    expect(result).toHaveProperty('timestamp')
    const timestamp = (result as { timestamp: string }).timestamp
    const resultDate = new Date(timestamp)

    expect(resultDate.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(resultDate.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ============================================================================
// Complete Transformation Tests
// ============================================================================

describe('Complete Transformation', () => {
  it('transforms LCP metric completely', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'LCP',
      value: 2500,
      rating: 'good',
      delta: 200,
      id: 'v3-1705329045123-4567890123456789',
      navigationType: 'navigate',
      entries: [createMockLCPEntry({ tagName: 'IMG' })],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com/products',
      ns: 'ecommerce',
      sessionId: 'session-xyz',
    }) as Record<string, unknown>

    // Core identity
    expect(result.event_type).toBe('vital')
    expect(result.event_name).toBe('LCP')
    expect(result.ns).toBe('ecommerce')

    // Causality
    expect(result.span_id).toBe('v3-1705329045123-4567890123456789')
    expect(result.session_id).toBe('session-xyz')

    // Web Vitals
    expect(result.vital_name).toBe('LCP')
    expect(result.vital_value).toBe(2500)
    expect(result.vital_rating).toBe('good')
    expect(result.vital_delta).toBe(200)
    expect(result.vital_element).toBe('IMG')
    expect(result.nav_type).toBe('navigate')

    // Timing (LCP is a timing vital)
    expect(result.duration_ms).toBe(2500)

    // HTTP
    expect(result.http_url).toBe('https://example.com/products')
  })

  it('transforms CLS metric completely', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'CLS',
      value: 0.15,
      rating: 'needs-improvement',
      delta: 0.05,
      id: 'v3-cls-123',
      navigationType: 'reload',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com/dashboard',
      ns: 'app',
    }) as Record<string, unknown>

    // Core identity
    expect(result.event_type).toBe('vital')
    expect(result.event_name).toBe('CLS')
    expect(result.ns).toBe('app')

    // Web Vitals
    expect(result.vital_name).toBe('CLS')
    expect(result.vital_value).toBe(0.15)
    expect(result.vital_rating).toBe('needs-improvement')
    expect(result.vital_delta).toBe(0.05)
    expect(result.nav_type).toBe('reload')

    // CLS is NOT a timing vital
    expect(result.duration_ms).toBe(null)

    // No element for CLS
    expect(result.vital_element).toBe(null)
  })

  it('transforms INP metric completely', () => {
    expect(transformWebVital, 'transformWebVital must be defined').toBeDefined()

    const vital: WebVitalMetric = {
      name: 'INP',
      value: 200,
      rating: 'good',
      delta: 50,
      id: 'v3-inp-456',
      navigationType: 'back_forward',
      entries: [],
    }

    const result = transformWebVital!(vital, {
      pageUrl: 'https://example.com/checkout',
      ns: 'payments',
    }) as Record<string, unknown>

    expect(result.event_type).toBe('vital')
    expect(result.event_name).toBe('INP')
    expect(result.vital_name).toBe('INP')
    expect(result.vital_value).toBe(200)
    expect(result.duration_ms).toBe(200) // INP is a timing vital
    expect(result.nav_type).toBe('back_forward')
  })
})
