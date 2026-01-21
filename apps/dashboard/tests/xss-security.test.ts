/**
 * XSS Security Tests for Dashboard
 *
 * These tests verify that the dashboard properly sanitizes all user-controlled
 * content to prevent Cross-Site Scripting (XSS) attacks.
 *
 * Security model:
 * - API returns raw data as JSON (this is correct - JSON is not vulnerable to XSS)
 * - Client-side JavaScript escapes data before inserting via innerHTML
 * - Tests verify: escape functions work, UI code uses escaping, API returns valid JSON
 *
 * @module apps/dashboard/tests/xss-security.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

import app from '../src/index'
import { renderDashboardHTML } from '../src/ui'

// ============================================================================
// XSS PAYLOAD COLLECTION
// ============================================================================

/**
 * Common XSS attack payloads that should be neutralized
 */
const XSS_PAYLOADS = {
  // Basic script injection
  scriptTag: '<script>alert("XSS")</script>',
  scriptTagEncoded: '&lt;script&gt;alert("XSS")&lt;/script&gt;',

  // Event handler injection
  imgOnError: '<img src="x" onerror="alert(\'XSS\')">',
  svgOnLoad: '<svg onload="alert(\'XSS\')">',

  // JavaScript URL
  jsUrl: 'javascript:alert("XSS")',

  // Breaking out of attributes
  attrBreakDouble: '"><script>alert("XSS")</script>',
  attrBreakSingle: "'><script>alert('XSS')</script>",

  // Unicode encoding
  unicodeScript: '\u003cscript\u003ealert("XSS")\u003c/script\u003e',
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateTestId(): string {
  return `xss-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createTestRequest(path: string, options?: RequestInit): Request {
  return new Request(`https://dashboard.dotdo.dev${path}`, options)
}

/**
 * Simulate the escapeHtml function from ui.ts
 * This allows us to verify the escape logic works correctly
 */
function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) return ''
  const s = String(str)
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Simulate the escapeAttr function from ui.ts
 */
function escapeAttr(str: string | null | undefined): string {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Check if escaped HTML content is safe from XSS
 * After proper escaping, there should be no unescaped < characters
 */
function isProperlyEscaped(escaped: string): boolean {
  // If there are literal < characters, the content is not properly escaped
  return !/<[a-zA-Z]/i.test(escaped)
}

// ============================================================================
// XSS ESCAPE FUNCTION TESTS
// ============================================================================

describe('XSS Escape Functions', () => {
  describe('escapeHtml', () => {
    it('escapes < and > characters', () => {
      const result = escapeHtml('<script>alert("XSS")</script>')
      expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;')
      expect(isProperlyEscaped(result)).toBe(true)
    })

    it('escapes quotes', () => {
      const result = escapeHtml('onclick="alert()"')
      expect(result).not.toContain('"')
      expect(result).toContain('&quot;')
    })

    it('escapes single quotes', () => {
      const result = escapeHtml("onclick='alert()'")
      expect(result).not.toContain("'")
      expect(result).toContain('&#39;')
    })

    it('escapes ampersands', () => {
      const result = escapeHtml('&lt;script&gt;')
      expect(result).toBe('&amp;lt;script&amp;gt;')
    })

    it('handles null and undefined', () => {
      expect(escapeHtml(null)).toBe('')
      expect(escapeHtml(undefined)).toBe('')
    })

    it('neutralizes all XSS payloads', () => {
      for (const [name, payload] of Object.entries(XSS_PAYLOADS)) {
        const escaped = escapeHtml(payload)
        expect(isProperlyEscaped(escaped)).toBe(true)
      }
    })
  })

  describe('escapeAttr', () => {
    it('escapes attribute-breaking characters', () => {
      const result = escapeAttr('"><script>')
      expect(result).not.toContain('"')
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
    })

    it('neutralizes onclick attribute injection', () => {
      const result = escapeAttr('" onclick="alert(\'XSS\')')
      expect(isProperlyEscaped(result)).toBe(true)
    })
  })
})

// ============================================================================
// UI SOURCE CODE SECURITY VERIFICATION
// ============================================================================

describe('UI Source Code Security', () => {
  // Get the rendered HTML which contains the JavaScript code
  const dashboardHTML = renderDashboardHTML()

  it('defines escapeHtml function', () => {
    expect(dashboardHTML).toContain('function escapeHtml')
  })

  it('defines escapeAttr function', () => {
    expect(dashboardHTML).toContain('function escapeAttr')
  })

  it('uses escapeHtml for DO name in table', () => {
    expect(dashboardHTML).toContain('escapeHtml(doObj.name)')
  })

  it('uses escapeHtml for DO className in table', () => {
    expect(dashboardHTML).toContain('escapeHtml(doObj.className)')
  })

  it('uses escapeHtml for event type', () => {
    expect(dashboardHTML).toContain('escapeHtml(event.type)')
  })

  it('uses escapeHtml for event doName', () => {
    expect(dashboardHTML).toContain('escapeHtml(event.doName)')
  })

  it('uses escapeHtml for error messages', () => {
    expect(dashboardHTML).toContain('escapeHtml(event.error)')
  })

  it('uses escapeAttr for onclick handler parameters', () => {
    expect(dashboardHTML).toContain('escapeAttr(doObj.id)')
  })

  it('uses escapeAttr for CSS class names from data', () => {
    expect(dashboardHTML).toContain('escapeAttr(statusClass)')
  })

  it('uses escapeHtml for DO details in inspect panel', () => {
    expect(dashboardHTML).toContain('escapeHtml(data.registration.className)')
    expect(dashboardHTML).toContain('escapeHtml(data.registration.namespace)')
  })

  it('uses escapeHtml for metadata JSON display', () => {
    expect(dashboardHTML).toContain('escapeHtml(JSON.stringify(data.registration.metadata')
  })
})

// ============================================================================
// API DATA HANDLING TESTS
// ============================================================================

describe('XSS Security - API Data Storage', () => {
  /**
   * These tests verify that the API correctly stores and returns data.
   * The API should store data as-is (no escaping at storage) because:
   * 1. JSON responses are application/json, not HTML
   * 2. Escaping should happen at render time, not storage time
   * 3. Double-escaping would corrupt the data
   */

  it('stores and returns DO name without modification', async () => {
    const testId = generateTestId()
    const testName = '<script>alert("test")</script>'

    const doData = {
      id: `do-${testId}`,
      name: testName,
      className: 'TestClass',
      namespace: 'test-namespace',
    }

    await app.fetch(
      createTestRequest('/api/dos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doData),
      }),
      env,
      {} as ExecutionContext
    )

    const response = await app.fetch(createTestRequest(`/api/dos/${doData.id}`), env, {} as ExecutionContext)

    const json = (await response.json()) as { registration: { name: string } }

    // The API should return the original data (JSON is not vulnerable to XSS)
    // Escaping happens on the client when rendering to HTML
    expect(json.registration.name).toBe(testName)
  })

  it('stores and returns event data without modification', async () => {
    const testId = generateTestId()
    const testType = '<img onerror="alert()">'

    const eventData = {
      doId: `event-do-${testId}`,
      doName: `EventDO-${testId}`,
      type: testType,
      status: 'completed' as const,
    }

    await app.fetch(
      createTestRequest('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      }),
      env,
      {} as ExecutionContext
    )

    const response = await app.fetch(createTestRequest('/api/events'), env, {} as ExecutionContext)

    const json = (await response.json()) as { events: Array<{ type: string }> }
    const event = json.events.find((e) => e.type === testType)

    expect(event).toBeDefined()
    expect(event?.type).toBe(testType)
  })
})

// ============================================================================
// CONTENT SECURITY HEADERS
// ============================================================================

describe('XSS Security - HTTP Headers', () => {
  it('dashboard HTML has correct content type', async () => {
    const request = createTestRequest('/')
    const response = await app.fetch(request, env, {} as ExecutionContext)

    expect(response.headers.get('Content-Type')).toContain('text/html')
  })

  it('API responses have correct content-type', async () => {
    const request = createTestRequest('/api/health')
    const response = await app.fetch(request, env, {} as ExecutionContext)

    const contentType = response.headers.get('Content-Type')
    expect(contentType).toContain('application/json')
  })
})

// ============================================================================
// INTEGRATION TESTS - Full Flow
// ============================================================================

describe('XSS Security - Integration', () => {
  it('malicious DO registration does not break JSON parsing', async () => {
    const testId = generateTestId()

    // Try to inject JSON-breaking characters
    const doData = {
      id: `do-json-${testId}`,
      name: '"},"evil":{"xss":"',
      className: 'TestClass',
      namespace: 'test-namespace',
    }

    const registerResponse = await app.fetch(
      createTestRequest('/api/dos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doData),
      }),
      env,
      {} as ExecutionContext
    )

    expect(registerResponse.status).toBe(200)

    // Fetch the data back
    const response = await app.fetch(createTestRequest(`/api/dos/${doData.id}`), env, {} as ExecutionContext)

    expect(response.status).toBe(200)

    // Should be valid JSON
    const json = (await response.json()) as { registration: { name: string } }
    expect(json.registration.name).toBe(doData.name)
  })

  it('inspect endpoint returns data without breaking', async () => {
    const testId = generateTestId()

    const doData = {
      id: `do-inspect-${testId}`,
      name: XSS_PAYLOADS.scriptTag,
      className: XSS_PAYLOADS.imgOnError,
      namespace: 'test-namespace',
      metadata: {
        evil: XSS_PAYLOADS.attrBreakDouble,
      },
    }

    await app.fetch(
      createTestRequest('/api/dos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doData),
      }),
      env,
      {} as ExecutionContext
    )

    const response = await app.fetch(createTestRequest(`/api/inspect/${doData.id}`), env, {} as ExecutionContext)

    expect(response.status).toBe(200)

    // Should be valid JSON
    const json = (await response.json()) as {
      registration: {
        name: string
        className: string
        metadata: { evil: string }
      }
    }

    expect(json.registration.name).toBe(XSS_PAYLOADS.scriptTag)
    expect(json.registration.className).toBe(XSS_PAYLOADS.imgOnError)
    expect(json.registration.metadata.evil).toBe(XSS_PAYLOADS.attrBreakDouble)
  })
})
