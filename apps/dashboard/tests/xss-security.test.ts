/**
 * XSS Security Tests for Dashboard
 *
 * These tests verify that the dashboard properly sanitizes all user-controlled
 * content to prevent Cross-Site Scripting (XSS) attacks.
 *
 * TDD Red-Green-Refactor: RED phase - tests should fail until innerHTML is fixed
 *
 * @module apps/dashboard/tests/xss-security.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

import app from '../src/index'

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
  bodyOnLoad: '<body onload="alert(\'XSS\')">',

  // JavaScript URL
  jsUrl: 'javascript:alert("XSS")',
  jsUrlEncoded: 'javascript&#58;alert("XSS")',

  // Data URL with script
  dataUrl: 'data:text/html,<script>alert("XSS")</script>',

  // Event attributes on common elements
  divOnMouseOver: '<div onmouseover="alert(\'XSS\')">hover me</div>',
  inputOnFocus: '<input onfocus="alert(\'XSS\')" autofocus>',

  // Template literal injection attempts
  templateInjection: '${alert("XSS")}',
  backtickInjection: '`${alert("XSS")}`',

  // Breaking out of attributes
  attrBreakDouble: '"><script>alert("XSS")</script>',
  attrBreakSingle: "'><script>alert('XSS')</script>",

  // Style-based XSS
  styleExpression: '<style>body{background:url("javascript:alert(\'XSS\')")}</style>',

  // Unicode/encoding bypasses
  unicodeScript: '\u003cscript\u003ealert("XSS")\u003c/script\u003e',

  // Nested/obfuscated
  nestedTags: '<<script>script>alert("XSS")<</script>/script>',
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
 * Check if HTML content contains any executable XSS patterns
 * Returns true if XSS patterns are found (bad), false if safe
 */
function containsExecutableXSS(html: string): boolean {
  // Check for unescaped script tags
  if (/<script[^>]*>/i.test(html)) return true

  // Check for event handlers
  if (/\bon\w+\s*=/i.test(html)) return true

  // Check for javascript: URLs
  if (/javascript\s*:/i.test(html)) return true

  // Check for data: URLs that could execute
  if (/data\s*:\s*text\/html/i.test(html)) return true

  return false
}

/**
 * Check if a string is properly HTML-escaped
 */
function isProperlyEscaped(original: string, inHtml: string): boolean {
  // If original contained <, it should be escaped to &lt; in HTML
  if (original.includes('<') && !inHtml.includes('&lt;')) {
    // Could still be safe if the entire string was textContent-ified
    // Check if the dangerous pattern is NOT present
    return !containsExecutableXSS(inHtml)
  }
  return true
}

// ============================================================================
// XSS SECURITY TEST SUITES
// ============================================================================

describe('XSS Security - DO Registration', () => {
  /**
   * Tests that DO names containing XSS payloads are safely rendered
   */

  it('escapes XSS in DO name field', async () => {
    const testId = generateTestId()
    const maliciousName = XSS_PAYLOADS.scriptTag

    // Register a DO with malicious name
    const doData = {
      id: `do-${testId}`,
      name: maliciousName,
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

    // Fetch the DO list
    const listResponse = await app.fetch(createTestRequest('/api/dos'), env, {} as ExecutionContext)
    const listJson = (await listResponse.json()) as { dos: Array<{ name: string }> }

    // The stored name should be the same (backend stores raw)
    const registeredDO = listJson.dos.find((d) => d.name === maliciousName)
    expect(registeredDO).toBeDefined()

    // The critical test: when this is rendered in HTML, it must be escaped
    // We verify by checking the inspect endpoint which returns HTML-renderable data
    const inspectResponse = await app.fetch(createTestRequest(`/api/inspect/${doData.id}`), env, {} as ExecutionContext)

    // If XSS is present in the API response, it's a vulnerability
    // The client-side code uses innerHTML with this data
    const inspectText = await inspectResponse.text()

    // The name appears in the response - verify it's not executable
    expect(containsExecutableXSS(inspectText)).toBe(false)
  })

  it('escapes XSS in DO className field', async () => {
    const testId = generateTestId()
    const maliciousClassName = XSS_PAYLOADS.imgOnError

    const doData = {
      id: `do-class-${testId}`,
      name: `TestDO-${testId}`,
      className: maliciousClassName,
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in DO namespace field', async () => {
    const testId = generateTestId()
    const maliciousNamespace = XSS_PAYLOADS.svgOnLoad

    const doData = {
      id: `do-ns-${testId}`,
      name: `TestDO-${testId}`,
      className: 'TestClass',
      namespace: maliciousNamespace,
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in DO metadata JSON', async () => {
    const testId = generateTestId()

    const doData = {
      id: `do-meta-${testId}`,
      name: `TestDO-${testId}`,
      className: 'TestClass',
      namespace: 'test-namespace',
      metadata: {
        description: XSS_PAYLOADS.scriptTag,
        nested: {
          value: XSS_PAYLOADS.imgOnError,
        },
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })
})

describe('XSS Security - Events', () => {
  /**
   * Tests that event data containing XSS payloads are safely rendered
   */

  it('escapes XSS in event type field', async () => {
    const testId = generateTestId()
    const maliciousType = XSS_PAYLOADS.attrBreakDouble

    const eventData = {
      doId: `event-do-${testId}`,
      doName: `EventDO-${testId}`,
      type: maliciousType,
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in event doName field', async () => {
    const testId = generateTestId()
    const maliciousDoName = XSS_PAYLOADS.divOnMouseOver

    const eventData = {
      doId: `event-do-${testId}`,
      doName: maliciousDoName,
      type: 'test.event',
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in event error message', async () => {
    const testId = generateTestId()
    const maliciousError = XSS_PAYLOADS.inputOnFocus

    const eventData = {
      doId: `event-do-${testId}`,
      doName: `EventDO-${testId}`,
      type: 'test.error',
      status: 'failed' as const,
      error: maliciousError,
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

    // Get events filtered by failed status
    const response = await app.fetch(createTestRequest('/api/events?status=failed'), env, {} as ExecutionContext)

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in event payload', async () => {
    const testId = generateTestId()

    const eventData = {
      doId: `event-do-${testId}`,
      doName: `EventDO-${testId}`,
      type: 'test.payload',
      status: 'completed' as const,
      payload: {
        userInput: XSS_PAYLOADS.scriptTag,
        nested: {
          value: XSS_PAYLOADS.jsUrl,
        },
      },
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

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })
})

describe('XSS Security - Combined Report Endpoint', () => {
  /**
   * Tests the combined report endpoint which handles multiple data types
   */

  it('escapes XSS across all report fields', async () => {
    const testId = generateTestId()

    const reportData = {
      do: {
        id: `report-do-${testId}`,
        name: XSS_PAYLOADS.scriptTag,
        className: XSS_PAYLOADS.imgOnError,
        namespace: XSS_PAYLOADS.svgOnLoad,
        metadata: {
          xss: XSS_PAYLOADS.attrBreakDouble,
        },
      },
      event: {
        type: XSS_PAYLOADS.divOnMouseOver,
        status: 'completed' as const,
        error: XSS_PAYLOADS.inputOnFocus,
      },
    }

    await app.fetch(
      createTestRequest('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      }),
      env,
      {} as ExecutionContext
    )

    // Fetch the inspect data which combines all fields
    const response = await app.fetch(createTestRequest(`/api/inspect/${reportData.do.id}`), env, {} as ExecutionContext)

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })
})

describe('XSS Security - Multiple Payload Types', () => {
  /**
   * Tests all XSS payload types against DO registration
   */

  Object.entries(XSS_PAYLOADS).forEach(([payloadName, payload]) => {
    it(`neutralizes ${payloadName} payload in DO name`, async () => {
      const testId = generateTestId()

      const doData = {
        id: `do-${payloadName}-${testId}`,
        name: payload,
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

      const response = await app.fetch(createTestRequest(`/api/inspect/${doData.id}`), env, {} as ExecutionContext)

      if (response.status === 200) {
        const text = await response.text()
        expect(containsExecutableXSS(text)).toBe(false)
      }
    })
  })
})

describe('XSS Security - ID Parameter Injection', () => {
  /**
   * Tests that ID parameters in URLs cannot be used for XSS
   */

  it('escapes XSS in DO ID path parameter', async () => {
    const maliciousId = XSS_PAYLOADS.scriptTag

    // Try to fetch with malicious ID (will likely 404, but should not expose XSS)
    const response = await app.fetch(createTestRequest(`/api/dos/${encodeURIComponent(maliciousId)}`), env, {} as ExecutionContext)

    // Response should either be 404 or safe
    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })

  it('escapes XSS in inspect ID path parameter', async () => {
    const maliciousId = XSS_PAYLOADS.imgOnError

    const response = await app.fetch(createTestRequest(`/api/inspect/${encodeURIComponent(maliciousId)}`), env, {} as ExecutionContext)

    const text = await response.text()
    expect(containsExecutableXSS(text)).toBe(false)
  })
})
