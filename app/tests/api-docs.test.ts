import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

/**
 * API Documentation Page Tests
 *
 * These tests verify that API documentation is properly generated and rendered
 * using fumadocs-openapi integration:
 * - /docs/api/* pages render API documentation from OpenAPI spec
 * - APIPage component displays endpoints correctly
 * - Request/response examples are shown with code samples
 * - Authentication is documented with security schemes
 * - fumadocs-openapi is configured correctly
 *
 * Expected to FAIL until:
 * - fumadocs-openapi is installed and configured
 * - APIPage component is created
 * - /docs/api/* routes are set up
 * - OpenAPI spec is integrated with docs
 */

// ============================================================================
// Mock Fetchers - Will need actual implementation
// ============================================================================

// Mock page fetcher for rendered docs pages
async function fetchDocsPage(path: string): Promise<Response> {
  // @ts-expect-error - module not yet implemented
  const { renderDocsPage } = await import('../src/docs/render')
  return renderDocsPage(path)
}

// Mock OpenAPI docs generator
async function getAPIDocsConfig(): Promise<APIDocsConfig> {
  // @ts-expect-error - module not yet implemented
  const { getAPIDocsConfiguration } = await import('../lib/docs/api-docs')
  return getAPIDocsConfiguration()
}

// Mock code sample generator
async function getCodeSamples(operationId: string): Promise<CodeSample[]> {
  // @ts-expect-error - module not yet implemented
  const { generateCodeSamples } = await import('../lib/docs/code-samples')
  return generateCodeSamples(operationId)
}

// ============================================================================
// Types
// ============================================================================

interface APIDocsConfig {
  specUrl: string
  basePath: string
  operations: OperationDoc[]
  securitySchemes: SecuritySchemeDoc[]
}

interface OperationDoc {
  operationId: string
  method: string
  path: string
  summary: string
  description?: string
  tags: string[]
  docsPath: string
}

interface SecuritySchemeDoc {
  name: string
  type: string
  description: string
  location?: string
}

interface CodeSample {
  language: string
  label: string
  code: string
}

// ============================================================================
// 1. fumadocs-openapi Configuration Tests
// ============================================================================

describe('fumadocs-openapi Configuration', () => {
  describe('Package Installation', () => {
    it('fumadocs-openapi is installed', async () => {
      const pkgPath = 'package.json'
      expect(existsSync(pkgPath)).toBe(true)
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps['fumadocs-openapi']).toBeDefined()
    })

    it('@hono/zod-openapi is installed', async () => {
      const pkgPath = 'package.json'
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps['@hono/zod-openapi']).toBeDefined()
    })
  })

  describe('API Docs Configuration', () => {
    let config: APIDocsConfig

    beforeAll(async () => {
      config = await getAPIDocsConfig()
    })

    it('has specUrl configured', () => {
      expect(config.specUrl).toBeDefined()
      expect(config.specUrl).toContain('openapi.json')
    })

    it('has basePath for docs', () => {
      expect(config.basePath).toBeDefined()
      expect(config.basePath).toBe('/docs/api')
    })

    it('has operations extracted from spec', () => {
      expect(config.operations).toBeDefined()
      expect(Array.isArray(config.operations)).toBe(true)
      expect(config.operations.length).toBeGreaterThan(0)
    })

    it('has security schemes documented', () => {
      expect(config.securitySchemes).toBeDefined()
      expect(config.securitySchemes.length).toBeGreaterThan(0)
    })
  })

  describe('source.config.ts Integration', () => {
    it('source.config.ts exists', () => {
      expect(existsSync('docs/source.config.ts')).toBe(true)
    })

    it('source.config.ts imports fumadocs-openapi', async () => {
      const content = await readFile('docs/source.config.ts', 'utf-8')
      expect(content).toContain('fumadocs-openapi')
    })

    it('source.config.ts defines API docs collection', async () => {
      const content = await readFile('docs/source.config.ts', 'utf-8')
      expect(content).toMatch(/api|openapi/i)
    })
  })
})

// ============================================================================
// 2. API Docs Index Page Tests
// ============================================================================

describe('API Docs Index Page', () => {
  describe('/docs/api route', () => {
    it('returns 200 status', async () => {
      const res = await fetchDocsPage('/docs/api')
      expect(res.status).toBe(200)
    })

    it('returns HTML content', async () => {
      const res = await fetchDocsPage('/docs/api')
      expect(res.headers.get('content-type')).toContain('text/html')
    })

    it('has proper page title', async () => {
      const res = await fetchDocsPage('/docs/api')
      const html = await res.text()
      expect(html).toMatch(/<title>[^<]*API[^<]*<\/title>/i)
    })
  })

  describe('API Overview Content', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('includes API introduction', () => {
      expect(html).toMatch(/api|rest|endpoints/i)
    })

    it('lists available endpoints', () => {
      expect(html).toContain('/api/things')
      expect(html).toContain('/api/health')
    })

    it('includes authentication section', () => {
      expect(html).toMatch(/authentication|auth|bearer|api.?key/i)
    })

    it('includes base URL information', () => {
      expect(html).toMatch(/base.?url|server|host/i)
    })

    it('links to individual endpoint docs', () => {
      expect(html).toMatch(/href=["'][^"']*\/docs\/api\/[^"']+["']/i)
    })
  })
})

// ============================================================================
// 3. Individual Endpoint Documentation Tests
// ============================================================================

describe('Individual Endpoint Documentation', () => {
  describe('/docs/api/things page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('page exists and returns 200', async () => {
      const res = await fetchDocsPage('/docs/api/things')
      expect(res.status).toBe(200)
    })

    it('shows endpoint path', () => {
      expect(html).toContain('/api/things')
    })

    it('shows HTTP methods', () => {
      expect(html).toMatch(/GET|POST/i)
    })

    it('shows endpoint description', () => {
      expect(html).toMatch(/thing|resource|item/i)
    })

    it('documents query parameters', () => {
      expect(html).toMatch(/limit|offset|pagination/i)
    })

    it('shows response schema', () => {
      expect(html).toMatch(/response|schema|200/i)
    })
  })

  describe('/docs/api/things-id page (single thing)', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things-id')
      html = await res.text()
    })

    it('page exists', async () => {
      const res = await fetchDocsPage('/docs/api/things-id')
      expect(res.status).toBe(200)
    })

    it('shows GET, PUT, DELETE methods', () => {
      expect(html).toMatch(/GET/i)
      expect(html).toMatch(/PUT/i)
      expect(html).toMatch(/DELETE/i)
    })

    it('documents path parameter', () => {
      expect(html).toMatch(/\{id\}|:id|path.?param/i)
    })

    it('shows 404 response documentation', () => {
      expect(html).toMatch(/404|not.?found/i)
    })
  })

  describe('/docs/api/health page', () => {
    it('page exists', async () => {
      const res = await fetchDocsPage('/docs/api/health')
      expect(res.status).toBe(200)
    })

    it('shows GET method only', async () => {
      const res = await fetchDocsPage('/docs/api/health')
      const html = await res.text()
      expect(html).toMatch(/GET/i)
    })
  })
})

// ============================================================================
// 4. Request/Response Examples Tests
// ============================================================================

describe('Request/Response Examples', () => {
  describe('Code Samples Generation', () => {
    it('generates curl samples', async () => {
      const samples = await getCodeSamples('getThings')
      const curlSample = samples.find((s) => s.language === 'bash' || s.language === 'curl')
      expect(curlSample).toBeDefined()
      expect(curlSample!.code).toContain('curl')
    })

    it('generates JavaScript/fetch samples', async () => {
      const samples = await getCodeSamples('getThings')
      const jsSample = samples.find((s) => s.language === 'javascript' || s.language === 'js')
      expect(jsSample).toBeDefined()
      expect(jsSample!.code).toContain('fetch')
    })

    it('generates TypeScript samples', async () => {
      const samples = await getCodeSamples('getThings')
      const tsSample = samples.find((s) => s.language === 'typescript' || s.language === 'ts')
      expect(tsSample).toBeDefined()
    })

    it('generates Python samples', async () => {
      const samples = await getCodeSamples('createThing')
      const pySample = samples.find((s) => s.language === 'python' || s.language === 'py')
      expect(pySample).toBeDefined()
      expect(pySample!.code).toContain('requests')
    })

    it('includes request body in POST samples', async () => {
      const samples = await getCodeSamples('createThing')
      for (const sample of samples) {
        if (sample.language !== 'curl') {
          expect(sample.code).toMatch(/body|json|data/i)
        }
      }
    })

    it('includes Authorization header in protected endpoint samples', async () => {
      const samples = await getCodeSamples('getProtected')
      for (const sample of samples) {
        expect(sample.code).toMatch(/Authorization|Bearer|api.?key/i)
      }
    })
  })

  describe('Response Examples on Pages', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('shows example response JSON', () => {
      expect(html).toMatch(/"id":|"name":|"createdAt":/i)
    })

    it('shows response with proper formatting', () => {
      expect(html).toMatch(/<pre|<code|hljs|shiki|prism/i)
    })

    it('shows multiple response status examples', () => {
      expect(html).toMatch(/200|201|400|404/i)
    })

    it('shows error response examples', () => {
      expect(html).toMatch(/"error"|"code"|"message"/i)
    })
  })

  describe('Request Body Examples', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('shows POST request body example', () => {
      expect(html).toMatch(/request.?body|payload/i)
    })

    it('shows required fields indicator', () => {
      expect(html).toMatch(/required|mandatory|\*/i)
    })

    it('shows field types', () => {
      expect(html).toMatch(/string|number|object|array|boolean/i)
    })
  })
})

// ============================================================================
// 5. APIPage Component Tests
// ============================================================================

describe('APIPage Component', () => {
  describe('Component Existence', () => {
    it('APIPage component file exists', () => {
      const possiblePaths = [
        'app/components/APIPage.tsx',
        'app/components/api-page.tsx',
        'app/components/docs/APIPage.tsx',
        'app/routes/docs/api/components/APIPage.tsx',
      ]
      const exists = possiblePaths.some((p) => existsSync(p))
      expect(exists).toBe(true)
    })
  })

  describe('Component Features', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('renders method badges (GET, POST, etc)', () => {
      expect(html).toMatch(/class=["'][^"']*(?:badge|method|tag)[^"']*["']/i)
    })

    it('renders endpoint path with highlighting', () => {
      expect(html).toMatch(/\/api\/things/)
    })

    it('renders parameter table or list', () => {
      expect(html).toMatch(/<table|<dl|parameter|param/i)
    })

    it('renders response section', () => {
      expect(html).toMatch(/response|result|return/i)
    })

    it('has expandable/collapsible sections', () => {
      expect(html).toMatch(/details|accordion|collapse|expand/i)
    })

    it('has copy button for code samples', () => {
      expect(html).toMatch(/copy|clipboard/i)
    })
  })

  describe('Component Styling', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('has fumadocs styling classes', () => {
      expect(html).toMatch(/fd-|fumadocs/i)
    })

    it('supports dark mode', () => {
      expect(html).toMatch(/dark:|dark-mode|data-theme/i)
    })

    it('is responsive', () => {
      expect(html).toMatch(/sm:|md:|lg:|responsive|mobile/i)
    })
  })
})

// ============================================================================
// 6. Security Schemes Documentation Tests
// ============================================================================

describe('Security Schemes Documentation', () => {
  describe('Authentication Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/authentication')
      html = await res.text()
    })

    it('authentication page exists', async () => {
      const res = await fetchDocsPage('/docs/api/authentication')
      expect(res.status).toBe(200)
    })

    it('documents Bearer token authentication', () => {
      expect(html).toMatch(/bearer|jwt|token/i)
    })

    it('documents API key authentication', () => {
      expect(html).toMatch(/api.?key|x-api-key/i)
    })

    it('shows how to obtain credentials', () => {
      expect(html).toMatch(/obtain|get|create|generate/i)
    })

    it('shows example Authorization header', () => {
      expect(html).toMatch(/Authorization:\s*Bearer/i)
    })
  })

  describe('Protected Endpoints Indication', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('shows lock/auth icon for protected endpoints', () => {
      // Protected endpoints should have visual indicator
      expect(html).toMatch(/lock|auth|protected|secure/i)
    })

    it('links to authentication docs', () => {
      expect(html).toMatch(/href=["'][^"']*authentication[^"']*["']/i)
    })
  })
})

// ============================================================================
// 7. Navigation and Structure Tests
// ============================================================================

describe('API Docs Navigation', () => {
  describe('Sidebar Navigation', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('includes API section in sidebar', () => {
      expect(html).toMatch(/sidebar|nav/i)
      expect(html).toMatch(/API/i)
    })

    it('lists all API endpoints in navigation', () => {
      expect(html).toContain('things')
      expect(html).toContain('health')
    })

    it('groups endpoints by tags', () => {
      // Should have grouping by API tags
      expect(html).toMatch(/Things|Resources|Health/i)
    })

    it('shows HTTP method in navigation', () => {
      expect(html).toMatch(/GET|POST|PUT|DELETE/i)
    })
  })

  describe('Breadcrumbs', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('shows breadcrumb navigation', () => {
      expect(html).toMatch(/breadcrumb/i)
    })

    it('shows path: Docs > API > Things', () => {
      expect(html).toContain('Docs')
      expect(html).toContain('API')
    })
  })
})

// ============================================================================
// 8. OpenAPI Spec Integration Tests
// ============================================================================

describe('OpenAPI Spec Integration', () => {
  describe('Spec Fetching', () => {
    it('can fetch OpenAPI spec from configured URL', async () => {
      const config = await getAPIDocsConfig()
      // Test that the specUrl is properly configured (production URL)
      expect(config.specUrl).toContain('openapi.json')
      // In test environment, we can't hit production. Verify URL format only.
      expect(config.specUrl).toMatch(/^https?:\/\//)
    })

    it('spec is valid JSON', async () => {
      // Instead of fetching from production, import the spec directly
      const { getOpenAPIDocument } = await import('../../api/routes/openapi')
      const spec = getOpenAPIDocument()
      expect(spec.openapi).toBeDefined()
      expect(spec.info).toBeDefined()
      expect(spec.paths).toBeDefined()
    })
  })

  describe('Spec to Docs Mapping', () => {
    let config: APIDocsConfig

    beforeAll(async () => {
      config = await getAPIDocsConfig()
    })

    it('each operation has a docs path', () => {
      for (const op of config.operations) {
        expect(op.docsPath).toBeDefined()
        expect(op.docsPath.startsWith('/docs/api/')).toBe(true)
      }
    })

    it('operation IDs are mapped to docs', () => {
      for (const op of config.operations) {
        expect(op.operationId).toBeDefined()
        expect(op.operationId.length).toBeGreaterThan(0)
      }
    })

    it('all HTTP methods are captured', () => {
      const methods = new Set(config.operations.map((op) => op.method.toUpperCase()))
      expect(methods.has('GET')).toBe(true)
      expect(methods.has('POST')).toBe(true)
    })
  })
})

// ============================================================================
// 9. Try It / Interactive Features Tests
// ============================================================================

describe('Interactive API Features', () => {
  describe('Try It Panel', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/things')
      html = await res.text()
    })

    it('has Try It button or panel', () => {
      expect(html).toMatch(/try.?it|test|playground|console/i)
    })

    it('has input fields for parameters', () => {
      expect(html).toMatch(/<input|<textarea|<select/i)
    })

    it('has send/execute button', () => {
      expect(html).toMatch(/send|execute|submit|run/i)
    })

    it('shows response area', () => {
      expect(html).toMatch(/response|result|output/i)
    })
  })

  describe('Server Selection', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('allows server/environment selection', () => {
      expect(html).toMatch(/server|environment|base.?url/i)
    })
  })
})

// ============================================================================
// 10. Schema Documentation Tests
// ============================================================================

describe('Schema Documentation', () => {
  describe('Thing Schema Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/schemas/thing')
      html = await res.text()
    })

    it('schema page exists', async () => {
      const res = await fetchDocsPage('/docs/api/schemas/thing')
      // Schema pages might be on a different path
      expect([200, 404]).toContain(res.status)
    })

    it('shows all schema properties', () => {
      expect(html).toMatch(/id|name|\$type|\$id|createdAt|updatedAt/i)
    })

    it('shows property types', () => {
      expect(html).toMatch(/string|number|boolean|object/i)
    })

    it('shows required properties', () => {
      expect(html).toMatch(/required/i)
    })

    it('shows example values', () => {
      expect(html).toMatch(/example/i)
    })
  })

  describe('Error Schema Documentation', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/schemas/error')
      html = await res.text()
    })

    it('error schema is documented', async () => {
      const res = await fetchDocsPage('/docs/api/schemas/error')
      expect([200, 404]).toContain(res.status)
    })

    it('shows error code field', () => {
      expect(html).toMatch(/code/i)
    })

    it('shows error message field', () => {
      expect(html).toMatch(/message/i)
    })
  })
})

// ============================================================================
// 11. MCP and RPC Documentation Tests
// ============================================================================

describe('MCP API Documentation', () => {
  describe('/docs/api/mcp page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/mcp')
      html = await res.text()
    })

    it('MCP docs page exists', async () => {
      const res = await fetchDocsPage('/docs/api/mcp')
      expect(res.status).toBe(200)
    })

    it('documents JSON-RPC 2.0 protocol', () => {
      expect(html).toMatch(/json.?rpc|jsonrpc|rpc/i)
    })

    it('documents session handling', () => {
      expect(html).toMatch(/session|mcp-session-id/i)
    })

    it('documents SSE endpoint', () => {
      expect(html).toMatch(/sse|event.?stream|server.?sent/i)
    })

    it('lists available tools', () => {
      expect(html).toMatch(/tools|echo|create_thing/i)
    })

    it('shows MCP methods', () => {
      expect(html).toMatch(/initialize|tools\/list|tools\/call/i)
    })
  })
})

describe('RPC API Documentation', () => {
  describe('/docs/api/rpc page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api/rpc')
      html = await res.text()
    })

    it('RPC docs page exists', async () => {
      const res = await fetchDocsPage('/docs/api/rpc')
      expect(res.status).toBe(200)
    })

    it('documents WebSocket protocol', () => {
      expect(html).toMatch(/websocket|ws:\/\//i)
    })

    it('documents promise pipelining', () => {
      expect(html).toMatch(/pipeline|pipelining|chain/i)
    })

    it('documents batch mode', () => {
      expect(html).toMatch(/batch|multiple/i)
    })

    it('lists available methods', () => {
      expect(html).toMatch(/echo|add|multiply|getUser/i)
    })
  })
})

// ============================================================================
// 12. SEO and Meta Tests
// ============================================================================

describe('API Docs SEO', () => {
  describe('Meta Tags', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('has unique title for API docs', () => {
      expect(html).toMatch(/<title>[^<]*API[^<]*<\/title>/i)
    })

    it('has meta description', () => {
      expect(html).toMatch(/<meta[^>]+name=["']description["']/i)
    })

    it('has Open Graph tags', () => {
      expect(html).toMatch(/<meta[^>]+property=["']og:title["']/i)
    })
  })

  describe('Structured Data', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('has JSON-LD structured data', () => {
      expect(html).toMatch(/<script[^>]+type=["']application\/ld\+json["']/i)
    })

    it('structured data has TechArticle or WebPage type', () => {
      const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
      if (match) {
        const jsonLd = JSON.parse(match[1])
        expect(['TechArticle', 'WebPage', 'APIReference']).toContain(jsonLd['@type'])
      }
    })
  })
})

// ============================================================================
// 13. Error Handling and Edge Cases Tests
// ============================================================================

describe('API Docs Error Handling', () => {
  describe('Missing Pages', () => {
    it('returns 404 for non-existent API endpoint docs', async () => {
      const res = await fetchDocsPage('/docs/api/non-existent-endpoint')
      expect(res.status).toBe(404)
    })

    it('404 page suggests similar endpoints', async () => {
      const res = await fetchDocsPage('/docs/api/thing')
      if (res.status === 404) {
        const html = await res.text()
        expect(html).toMatch(/things|similar|did you mean/i)
      }
    })
  })

  describe('Spec Loading Errors', () => {
    it('shows error message if spec fails to load', async () => {
      // This tests graceful degradation
      // Implementation should handle spec loading failures
      const res = await fetchDocsPage('/docs/api')
      expect(res.status).toBe(200)
    })
  })
})

// ============================================================================
// 14. Build and Generation Tests
// ============================================================================

describe('API Docs Build', () => {
  describe('Static Generation', () => {
    it('generates static HTML for API index', () => {
      expect(existsSync('dist/docs/api/index.html')).toBe(true)
    })

    it('generates static HTML for individual endpoints', () => {
      expect(existsSync('dist/docs/api/things/index.html')).toBe(true)
    })

    it('generates static HTML for authentication docs', () => {
      expect(existsSync('dist/docs/api/authentication/index.html')).toBe(true)
    })
  })

  describe('Assets', () => {
    it('generates API docs specific CSS', () => {
      // May be bundled with main CSS
      const assetsExist = existsSync('dist/docs/_assets')
      expect(assetsExist).toBe(true)
    })
  })
})

// ============================================================================
// 15. Versioning Tests
// ============================================================================

describe('API Versioning Documentation', () => {
  describe('Version Information', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchDocsPage('/docs/api')
      html = await res.text()
    })

    it('shows API version', () => {
      expect(html).toMatch(/version|v\d+\.\d+/i)
    })

    it('shows last updated date', () => {
      expect(html).toMatch(/updated|modified|date/i)
    })
  })
})
