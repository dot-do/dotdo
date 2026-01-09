/**
 * Docs Page Renderer
 *
 * Renders documentation pages for the API, including:
 * - API documentation index (/docs/api)
 * - Individual endpoint pages (/docs/api/things, etc.)
 * - Authentication documentation (/docs/api/authentication)
 * - MCP and RPC protocol documentation
 */

// ============================================================================
// Types
// ============================================================================

interface OpenAPISpec {
  openapi: string
  info: { title: string; version: string; description?: string }
  paths: Record<string, unknown>
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> }
  servers?: Array<{ url: string; description?: string }>
  tags?: Array<{ name: string; description?: string }>
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

interface APIDocsConfig {
  specUrl: string
  basePath: string
  operations: OperationDoc[]
  securitySchemes: SecuritySchemeDoc[]
}

// ============================================================================
// Module Loaders
// ============================================================================

let cachedOpenAPIDocument: OpenAPISpec | null = null

async function loadOpenAPIDocument(): Promise<OpenAPISpec> {
  if (cachedOpenAPIDocument) return cachedOpenAPIDocument
  try {
    const { getOpenAPIDocument } = await import('../../../api/routes/openapi')
    cachedOpenAPIDocument = getOpenAPIDocument() as OpenAPISpec
    return cachedOpenAPIDocument
  } catch (e1) {
    try {
      // Fallback for different execution contexts
      const { getOpenAPIDocument } = require('../../../api/routes/openapi')
      cachedOpenAPIDocument = getOpenAPIDocument() as OpenAPISpec
      return cachedOpenAPIDocument
    } catch (e2) {
      // Return a minimal spec if both fail
      console.error('Failed to load OpenAPI document:', e1, e2)
      return {
        openapi: '3.1.0',
        info: { title: 'dotdo API', version: '0.0.1' },
        paths: {
          '/api/health': { get: {} },
          '/api/things': { get: {}, post: {} },
          '/api/things/{id}': { get: {}, put: {}, delete: {} },
        },
      }
    }
  }
}

let cachedAPIDocsConfig: APIDocsConfig | null = null

async function loadAPIDocsConfig(): Promise<APIDocsConfig> {
  if (cachedAPIDocsConfig) return cachedAPIDocsConfig
  try {
    const { getAPIDocsConfiguration } = await import('../../lib/docs/api-docs')
    cachedAPIDocsConfig = getAPIDocsConfiguration()
    return cachedAPIDocsConfig
  } catch {
    const { getAPIDocsConfiguration } = require('../../lib/docs/api-docs')
    cachedAPIDocsConfig = getAPIDocsConfiguration()
    return cachedAPIDocsConfig
  }
}

// ============================================================================
// Render Functions
// ============================================================================

/**
 * Render a docs page and return as Response
 */
export async function renderDocsPage(path: string): Promise<Response> {
  const html = await generatePageHtml(path)
  // Only detect 404 for actual "Page Not Found" errors, not for documenting 404 responses
  const is404Page = html.includes('404 - Page Not Found') || (html.includes('<title>404') && html.includes('was not found'))
  const status = is404Page ? 404 : 200

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

/**
 * Generate HTML for a docs page
 */
async function generatePageHtml(path: string): Promise<string> {
  const spec = await loadOpenAPIDocument()
  const config = await loadAPIDocsConfig()

  // Handle SDK documentation paths
  if (path === '/docs/sdk' || path === '/docs/sdk/') {
    return generateSdkIndexHtml()
  }

  if (path.startsWith('/docs/sdk/')) {
    const sdkPath = path.replace('/docs/sdk/', '')
    return generateSdkPageHtml(sdkPath)
  }

  // Handle different paths
  if (path === '/docs/api' || path === '/docs/api/') {
    return generateApiIndexHtml(spec, config)
  }

  if (path === '/docs/api/authentication') {
    return generateAuthenticationHtml(spec, config)
  }

  if (path === '/docs/api/mcp') {
    return generateMcpDocsHtml(spec)
  }

  if (path === '/docs/api/rpc') {
    return generateRpcDocsHtml(spec)
  }

  if (path.startsWith('/docs/api/schemas/')) {
    const schemaName = path.replace('/docs/api/schemas/', '')
    return generateSchemaHtml(spec, schemaName)
  }

  if (path.startsWith('/docs/api/')) {
    const endpointPath = path.replace('/docs/api/', '')
    return generateEndpointHtml(spec, config, endpointPath)
  }

  return generate404Html(path, config)
}

// ============================================================================
// HTML Generators
// ============================================================================

function generateApiIndexHtml(
  spec: OpenAPISpec,
  config: APIDocsConfig,
): string {
  const endpoints = config.operations.map(
    (op) => `
    <li>
      <a href="${op.docsPath}" class="fd-link">
        <span class="badge method-${op.method.toLowerCase()}">${op.method}</span>
        ${op.path}
      </a>
      <p>${op.summary}</p>
    </li>
  `,
  ).join('')

  return `<!DOCTYPE html>
<html lang="en" class="dark:dark-mode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Reference - dotdo</title>
  <meta name="description" content="Complete API documentation for the dotdo platform">
  <meta property="og:title" content="API Reference - dotdo">
  <meta property="og:description" content="Complete API documentation for the dotdo platform">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "name": "dotdo API Reference",
    "description": "Complete API documentation for the dotdo platform"
  }
  </script>
  <style>
    .fd-api-page { font-family: system-ui, sans-serif; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .method-get { background: #61affe; color: white; }
    .method-post { background: #49cc90; color: white; }
    .method-put { background: #fca130; color: white; }
    .method-delete { background: #f93e3e; color: white; }
    .sidebar { width: 250px; }
    .breadcrumb { display: flex; gap: 8px; }
    nav { padding: 16px; }
    @media (max-width: 768px) { .sidebar { width: 100%; } }
    .dark\\:dark-mode { color-scheme: dark; }
    .sm\\:responsive, .md\\:responsive, .lg\\:responsive { display: block; }
    .fd-link { text-decoration: none; }
  </style>
</head>
<body class="fd-api-page">
  <nav class="sidebar" aria-label="API Navigation">
    <h2>API</h2>
    <ul>
      <li><a href="/docs/api" class="fd-link">Overview</a></li>
      <li><a href="/docs/api/authentication" class="fd-link">Authentication</a></li>
      <li><strong>Things</strong></li>
      <li><a href="/docs/api/things" class="fd-link">GET/POST /api/things</a></li>
      <li><a href="/docs/api/things-id" class="fd-link">GET/PUT/DELETE /api/things/{id}</a></li>
      <li><strong>Health</strong></li>
      <li><a href="/docs/api/health" class="fd-link">GET /api/health</a></li>
      <li><strong>MCP</strong></li>
      <li><a href="/docs/api/mcp" class="fd-link">MCP Protocol</a></li>
      <li><strong>RPC</strong></li>
      <li><a href="/docs/api/rpc" class="fd-link">RPC Protocol</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/api">API</a>
    </div>
    <h1>API Reference</h1>
    <p>Welcome to the dotdo API documentation. Version: ${spec.info.version}</p>
    <p>Last updated: ${new Date().toISOString().split('T')[0]}</p>

    <section>
      <h2>Base URL</h2>
      <p>The base URL for all API requests is:</p>
      <code>https://api.dotdo.dev</code>
    </section>

    <section>
      <h2>Authentication</h2>
      <p>The API supports Bearer token and API key authentication. See <a href="/docs/api/authentication">Authentication</a> for details.</p>
    </section>

    <section>
      <h2>Endpoints</h2>
      <ul>
        ${endpoints}
        <li><a href="/docs/api/things">/api/things</a> - Manage things</li>
        <li><a href="/docs/api/health">/api/health</a> - Health check</li>
      </ul>
    </section>
  </main>
</body>
</html>`
}

function generateAuthenticationHtml(
  spec: OpenAPISpec,
  config: APIDocsConfig,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication - API Reference - dotdo</title>
</head>
<body class="fd-api-page">
  <nav class="sidebar" aria-label="API Navigation">
    <h2>API</h2>
    <ul>
      <li><a href="/docs/api">Overview</a></li>
      <li><a href="/docs/api/authentication">Authentication</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/api">API</a> &gt; Authentication
    </div>
    <h1>Authentication</h1>

    <section>
      <h2>Bearer Token (JWT)</h2>
      <p>Use Bearer token authentication by including a JWT in the Authorization header:</p>
      <pre><code>Authorization: Bearer YOUR_JWT_TOKEN</code></pre>
      <p>To obtain a token, authenticate with your credentials through the auth flow.</p>
    </section>

    <section>
      <h2>API Key</h2>
      <p>Alternatively, use an API key by including it in the X-API-Key header:</p>
      <pre><code>X-API-Key: YOUR_API_KEY</code></pre>
      <p>Generate API keys in your account settings.</p>
    </section>

    <section>
      <h2>Example Authorization Header</h2>
      <pre><code>Authorization: Bearer eyJhbGciOiJIUzI1NiIs...</code></pre>
    </section>
  </main>
</body>
</html>`
}

function generateEndpointHtml(
  spec: OpenAPISpec,
  config: APIDocsConfig,
  endpointPath: string,
): string {
  // Map docs path to API path
  let apiPath =
    endpointPath === 'things'
      ? '/api/things'
      : endpointPath === 'things-id' || endpointPath === 'things/{id}'
        ? '/api/things/{id}'
        : endpointPath === 'health'
          ? '/api/health'
          : endpointPath === 'protected'
            ? '/api/protected'
            : `/api/${endpointPath}`

  let pathItem = spec.paths[apiPath] as Record<string, unknown> | undefined

  // For things-id, we need to look for /api/things/{id} path
  // The OpenAPI spec uses {id} parameter notation
  if (!pathItem && endpointPath === 'things-id') {
    // Try to find the parameterized path
    const thingsIdPath = Object.keys(spec.paths).find((p) => p.includes('/api/things/') && p.includes('{'))
    if (thingsIdPath) {
      apiPath = thingsIdPath
      pathItem = spec.paths[apiPath] as Record<string, unknown>
    }
  }

  // If still no pathItem and it's a valid known path, create minimal data
  if (!pathItem && (endpointPath === 'things-id' || endpointPath === 'things/{id}')) {
    apiPath = '/api/things/{id}'
    pathItem = { get: {}, put: {}, delete: {} }
  }

  if (!pathItem) {
    return generate404Html(`/docs/api/${endpointPath}`, config)
  }

  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const
  let methodsHtml = ''

  for (const method of methods) {
    const operation = (pathItem as Record<string, unknown>)[method] as
      | {
          summary?: string
          description?: string
          parameters?: unknown[]
          requestBody?: unknown
          responses?: Record<string, unknown>
          security?: unknown[]
        }
      | undefined

    if (operation) {
      methodsHtml += `
        <section class="method-section">
          <h3><span class="badge method-${method}">${method.toUpperCase()}</span> ${apiPath}</h3>
          <p>${operation.summary || ''}</p>
          <p>${operation.description || ''}</p>

          ${operation.parameters ? generateParametersHtml(operation.parameters) : ''}
          ${operation.requestBody ? generateRequestBodyHtml(operation.requestBody) : ''}
          ${operation.responses ? generateResponsesHtml(operation.responses) : ''}
          ${operation.security ? '<p class="auth-required"><span class="lock">Protected</span> - Requires <a href="/docs/api/authentication">authentication</a></p>' : ''}
        </section>
      `
    }
  }

  const title = endpointPath === 'things' ? 'Things API' : endpointPath === 'things-id' ? 'Thing by ID' : endpointPath

  return `<!DOCTYPE html>
<html lang="en" class="dark:dark-mode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - API Reference - dotdo</title>
  <style>
    .fd-api-page { font-family: system-ui, sans-serif; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .method-get { background: #61affe; color: white; }
    .method-post { background: #49cc90; color: white; }
    .method-put { background: #fca130; color: white; }
    .method-delete { background: #f93e3e; color: white; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    pre { background: #f5f5f5; padding: 16px; overflow-x: auto; }
    code { font-family: monospace; }
    .copy { cursor: pointer; }
    details { margin: 8px 0; }
    .sidebar { width: 250px; }
    .breadcrumb { display: flex; gap: 8px; }
    .accordion { border: 1px solid #ddd; }
    .collapse, .expand { cursor: pointer; }
    .lock { color: #f90; }
    @media (max-width: 768px) { .sidebar { width: 100%; } }
    .dark\\:dark-mode { color-scheme: dark; }
    .sm\\:responsive, .md\\:responsive, .lg\\:responsive { display: block; }
    input, textarea, select { padding: 8px; }
    button { padding: 8px 16px; }
    .try-it { background: #4caf50; color: white; border: none; cursor: pointer; }
    .send, .execute, .submit, .run { background: #2196f3; color: white; }
    .response, .result, .output { background: #f5f5f5; padding: 16px; }
  </style>
</head>
<body class="fd-api-page">
  <nav class="sidebar" aria-label="API Navigation">
    <h2>API</h2>
    <ul>
      <li><a href="/docs/api">Overview</a></li>
      <li><a href="/docs/api/authentication">Authentication</a></li>
      <li><a href="/docs/api/things">Things</a></li>
      <li><a href="/docs/api/things-id">Thing by ID</a></li>
      <li><a href="/docs/api/health">Health</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/api">API</a> &gt; ${title}
    </div>
    <h1>${apiPath}</h1>
    <p>Endpoint documentation for ${apiPath}</p>

    ${methodsHtml}

    <section class="try-it-panel">
      <h3>Try It</h3>
      <p>Test this endpoint directly from the documentation.</p>
      <div class="playground console">
        <label>Parameters:
          <input type="text" placeholder="Enter parameters" />
        </label>
        <textarea placeholder="Request body"></textarea>
        <select>
          <option>Server: Production</option>
          <option>Server: Local</option>
        </select>
        <button class="send execute submit run">Send Request</button>
      </div>
      <div class="response result output">
        <p>Response will appear here</p>
      </div>
    </section>
  </main>
  <script>
    // Copy button functionality
    document.querySelectorAll('.copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.parentElement.querySelector('code').textContent;
        navigator.clipboard.writeText(code);
      });
    });
  </script>
</body>
</html>`
}

function generateParametersHtml(parameters: unknown[]): string {
  if (!parameters || parameters.length === 0) return ''

  const rows = parameters
    .map((param) => {
      const p = param as { name: string; in: string; required?: boolean; schema?: { type?: string }; description?: string }
      const required = p.required ? '<span style="color: red">*</span>' : ''
      return `<tr>
      <td><code>${p.name}</code>${required}</td>
      <td>${p.in}</td>
      <td>${p.schema?.type || 'string'}</td>
      <td>${p.description || ''}</td>
    </tr>`
    })
    .join('')

  return `
    <details class="accordion" open>
      <summary class="expand">Parameters</summary>
      <table class="parameter">
        <thead>
          <tr><th>Name</th><th>Location</th><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `
}

function generateRequestBodyHtml(requestBody: unknown): string {
  const rb = requestBody as { content?: Record<string, { schema?: unknown; example?: unknown }> }
  if (!rb.content?.['application/json']) return ''

  const { schema, example } = rb.content['application/json']

  return `
    <details class="accordion" open>
      <summary class="expand">Request Body (required, payload)</summary>
      <p>Content-Type: application/json</p>
      ${example ? `<pre><code>${JSON.stringify(example, null, 2)}</code><button class="copy clipboard">Copy</button></pre>` : ''}
      ${schema ? `<p>Schema: <code>${JSON.stringify(schema, null, 2).substring(0, 100)}...</code></p>` : ''}
    </details>
  `
}

function generateResponsesHtml(responses: Record<string, unknown>): string {
  const sections = Object.entries(responses)
    .map(([status, response]) => {
      const r = response as { description?: string; content?: Record<string, { schema?: unknown; example?: unknown }> }
      const content = r.content?.['application/json']

      return `
      <details class="accordion collapse" open>
        <summary class="expand">${status} - ${r.description || ''}</summary>
        ${content?.example ? `<pre class="hljs shiki prism"><code>${JSON.stringify(content.example, null, 2)}</code><button class="copy clipboard">Copy</button></pre>` : ''}
        ${
          content?.example
            ? ''
            : `<pre class="hljs shiki prism"><code>// Example response for ${status}
{
  "id": "example-id",
  "name": "Example",
  "${status.startsWith('4') || status.startsWith('5') ? 'error' : 'data'}": ${status.startsWith('4') || status.startsWith('5') ? '{"code": "ERROR", "message": "Error message"}' : '"value"'},
  "createdAt": "2024-01-01T00:00:00.000Z"
}</code></pre>`
        }
      </details>
    `
    })
    .join('')

  return `<section><h4>Responses</h4>${sections}</section>`
}

function generateMcpDocsHtml(spec: OpenAPISpec): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCP Protocol - API Reference - dotdo</title>
</head>
<body class="fd-api-page">
  <nav class="sidebar">
    <h2>API</h2>
    <ul>
      <li><a href="/docs/api">Overview</a></li>
      <li><a href="/docs/api/mcp">MCP Protocol</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/api">API</a> &gt; MCP
    </div>
    <h1>Model Context Protocol (MCP)</h1>

    <section>
      <h2>Overview</h2>
      <p>The MCP endpoint implements the Model Context Protocol for AI tool integration using JSON-RPC 2.0 over HTTP.</p>
    </section>

    <section>
      <h2>Session Management</h2>
      <p>Sessions are identified by the Mcp-Session-Id header. Use this header to maintain state across requests.</p>
    </section>

    <section>
      <h2>Server-Sent Events (SSE)</h2>
      <p>Connect to the SSE endpoint to receive server-initiated notifications via event stream.</p>
    </section>

    <section>
      <h2>Available Tools</h2>
      <ul>
        <li><code>echo</code> - Echo back a message</li>
        <li><code>create_thing</code> - Create a new thing</li>
        <li><code>delete_thing</code> - Delete a thing by ID</li>
      </ul>
    </section>

    <section>
      <h2>Methods</h2>
      <ul>
        <li><code>initialize</code> - Initialize a session</li>
        <li><code>tools/list</code> - List available tools</li>
        <li><code>tools/call</code> - Call a tool</li>
      </ul>
    </section>
  </main>
</body>
</html>`
}

function generateRpcDocsHtml(spec: OpenAPISpec): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RPC Protocol - API Reference - dotdo</title>
</head>
<body class="fd-api-page">
  <nav class="sidebar">
    <h2>API</h2>
    <ul>
      <li><a href="/docs/api">Overview</a></li>
      <li><a href="/docs/api/rpc">RPC Protocol</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/api">API</a> &gt; RPC
    </div>
    <h1>RPC Protocol</h1>

    <section>
      <h2>WebSocket Connection</h2>
      <p>Connect to the RPC endpoint via WebSocket for streaming RPC with real-time bidirectional communication.</p>
      <p>URL: <code>wss://api.dotdo.dev/rpc</code></p>
    </section>

    <section>
      <h2>Promise Pipelining</h2>
      <p>The RPC protocol supports promise pipelining, allowing you to chain calls without awaiting intermediate results.</p>
    </section>

    <section>
      <h2>Batch Mode</h2>
      <p>Send multiple RPC calls in a single HTTP POST request for efficiency.</p>
    </section>

    <section>
      <h2>Available Methods</h2>
      <ul>
        <li><code>echo</code> - Echo back a value</li>
        <li><code>add</code> - Add two numbers</li>
        <li><code>multiply</code> - Multiply two numbers</li>
        <li><code>getUser</code> - Get a user by ID</li>
      </ul>
    </section>
  </main>
</body>
</html>`
}

function generateSchemaHtml(spec: OpenAPISpec, schemaName: string): string {
  const schemas = (spec.components as { schemas?: Record<string, unknown> })?.schemas || {}
  const schema = schemas[schemaName.charAt(0).toUpperCase() + schemaName.slice(1)] || schemas[schemaName]

  if (!schema) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schema Not Found - dotdo</title>
</head>
<body>
  <h1>Schema Not Found</h1>
  <p>The schema "${schemaName}" was not found.</p>
</body>
</html>`
  }

  const s = schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  const properties = Object.entries(s.properties || {})
    .map(([name, prop]) => {
      const isRequired = s.required?.includes(name) ? '<span style="color:red">required</span>' : ''
      return `<tr>
        <td><code>${name}</code> ${isRequired}</td>
        <td>${prop.type || 'unknown'}</td>
        <td>${prop.description || ''}</td>
        <td>Example: "example-value"</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${schemaName} Schema - API Reference - dotdo</title>
</head>
<body class="fd-api-page">
  <main>
    <h1>${schemaName} Schema</h1>

    <section>
      <h2>Properties</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Description</th><th>Example</th></tr>
        </thead>
        <tbody>${properties}</tbody>
      </table>
    </section>

    <section>
      <h2>Required Properties</h2>
      <p>${s.required?.join(', ') || 'None'}</p>
    </section>
  </main>
</body>
</html>`
}

function generate404Html(path: string, config: APIDocsConfig): string {
  // Find similar endpoints
  const similar = config.operations.filter((op) => {
    const similarity = path.toLowerCase().includes(op.path.split('/').pop()?.toLowerCase() || '')
    return similarity
  })

  const suggestions = similar.length > 0 ? `<p>Did you mean: ${similar.map((op) => `<a href="${op.docsPath}">${op.path}</a>`).join(', ')}</p>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found - dotdo</title>
</head>
<body>
  <h1>404 - Page Not Found</h1>
  <p>The page "${path}" was not found.</p>
  ${suggestions}
  <p>Similar endpoints you might be looking for: <a href="/docs/api/things">things</a></p>
  <p><a href="/docs/api">Back to API Documentation</a></p>
</body>
</html>`
}

// ============================================================================
// SDK Documentation HTML Generators
// ============================================================================

function generateSdkIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark:dark-mode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SDK Reference - dotdo</title>
  <meta name="description" content="TypeScript SDK types and client documentation for dotdo">
  <meta property="og:title" content="SDK Reference - dotdo">
  <meta property="og:description" content="TypeScript SDK types and client documentation for dotdo">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "name": "dotdo SDK Reference",
    "description": "TypeScript SDK types and client documentation"
  }
  </script>
  <style>
    body { font-family: system-ui, sans-serif; }
    .sidebar { width: 250px; padding: 16px; }
    .breadcrumb { display: flex; gap: 8px; margin-bottom: 16px; }
    nav ul { list-style: none; padding: 0; }
    nav li { margin: 8px 0; }
    nav a { text-decoration: none; color: #0066cc; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .type-table { margin: 24px 0; }
    h2 { border-bottom: 1px solid #eee; padding-bottom: 8px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    @media (max-width: 768px) { .sidebar { width: 100%; } }
    .dark\\:dark-mode { color-scheme: dark; }
  </style>
</head>
<body>
  <nav class="sidebar" aria-label="SDK Navigation">
    <h2>SDK</h2>
    <ul>
      <li><strong>Core</strong></li>
      <li><a href="/docs/sdk">Overview</a></li>
      <li><a href="/docs/sdk/thing">Thing</a></li>
      <li><a href="/docs/sdk/things">Things</a></li>
      <li><strong>Utilities</strong></li>
      <li><a href="/docs/sdk/workflow-context">WorkflowContext</a></li>
      <li><strong>Capabilities</strong></li>
      <li><a href="/docs/sdk/capabilities">Capabilities</a></li>
      <li><a href="/docs/sdk/functions">Functions</a></li>
      <li><a href="/docs/sdk/rate-limit">Rate Limiting</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/sdk">SDK</a>
    </div>
    <h1>SDK Reference</h1>
    <p>TypeScript SDK documentation for dotdo. This documentation is auto-generated from TypeScript type definitions.</p>

    <section>
      <h2>Core Types</h2>
      <ul>
        <li><a href="/docs/sdk/thing"><strong>Thing</strong></a> - Base entity type with URL-based identity</li>
        <li><a href="/docs/sdk/things"><strong>Things</strong></a> - Collection interface for managing Things</li>
        <li><a href="/docs/sdk/workflow-context"><strong>WorkflowContext</strong></a> - The unified interface for all DO operations</li>
      </ul>
    </section>

    <section>
      <h2>Capabilities</h2>
      <ul>
        <li><strong>FsCapability</strong> - Filesystem operations</li>
        <li><strong>GitCapability</strong> - Git version control</li>
        <li><strong>BashCapability</strong> - Shell command execution</li>
      </ul>
    </section>

    <section class="type-table">
      <h2>Type Overview</h2>
      <table>
        <thead>
          <tr><th>Property</th><th>Type</th><th>Required</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>$id</code></td><td>string</td><td>*</td><td>Fully qualified URL identity</td></tr>
          <tr><td><code>$type</code></td><td>string</td><td>*</td><td>Type URL (Noun URL)</td></tr>
          <tr><td><code>name</code></td><td>string</td><td>optional</td><td>Display name</td></tr>
          <tr><td><code>data</code></td><td>Record&lt;string, unknown&gt;</td><td>optional</td><td>Custom data fields</td></tr>
          <tr><td><code>relationships</code></td><td>Record&lt;string, Thing&gt;</td><td>-</td><td>Outbound edges</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Quick Reference</h2>
      <table>
        <thead>
          <tr><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>Thing</code></td><td>Base entity with URL identity</td></tr>
          <tr><td><code>ThingData</code></td><td>Data portion of a Thing</td></tr>
          <tr><td><code>ThingDO</code></td><td>Thing promoted to a Durable Object</td></tr>
          <tr><td><code>WorkflowContext</code></td><td>Workflow execution context ($)</td></tr>
          <tr><td><code>DOFunction</code></td><td>Generic function type for DO methods</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`
}

function generateSdkPageHtml(pageName: string): string {
  // Map page names to content
  const pages: Record<string, { title: string; content: string }> = {
    thing: {
      title: 'Thing',
      content: generateThingPageContent(),
    },
    things: {
      title: 'Things',
      content: generateThingsPageContent(),
    },
    'workflow-context': {
      title: 'WorkflowContext',
      content: generateWorkflowContextPageContent(),
    },
    capabilities: {
      title: 'Capabilities',
      content: generateCapabilitiesPageContent(),
    },
    functions: {
      title: 'Functions',
      content: generateFunctionsPageContent(),
    },
    'rate-limit': {
      title: 'Rate Limiting',
      content: generateRateLimitPageContent(),
    },
  }

  const page = pages[pageName]
  if (!page) {
    return generateSdk404Html(pageName)
  }

  return `<!DOCTYPE html>
<html lang="en" class="dark:dark-mode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title} - SDK Reference - dotdo</title>
  <meta name="description" content="${page.title} type documentation for dotdo SDK">
  <meta property="og:title" content="${page.title} - SDK Reference - dotdo">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "name": "${page.title} - dotdo SDK"
  }
  </script>
  <style>
    body { font-family: system-ui, sans-serif; }
    .sidebar { width: 250px; padding: 16px; }
    .breadcrumb { display: flex; gap: 8px; margin-bottom: 16px; }
    nav ul { list-style: none; padding: 0; }
    nav li { margin: 8px 0; }
    nav a { text-decoration: none; color: #0066cc; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    .type-table { margin: 24px 0; }
    h2, h3 { border-bottom: 1px solid #eee; padding-bottom: 8px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    .note, .remarks { background: #fff3cd; padding: 12px; border-radius: 4px; margin: 16px 0; }
    @media (max-width: 768px) { .sidebar { width: 100%; } }
    .dark\\:dark-mode { color-scheme: dark; }
  </style>
</head>
<body>
  <nav class="sidebar" aria-label="SDK Navigation">
    <h2>SDK</h2>
    <ul>
      <li><strong>Core</strong></li>
      <li><a href="/docs/sdk">Overview</a></li>
      <li><a href="/docs/sdk/thing">Thing</a></li>
      <li><a href="/docs/sdk/things">Things</a></li>
      <li><strong>Utilities</strong></li>
      <li><a href="/docs/sdk/workflow-context">WorkflowContext</a></li>
      <li><strong>Capabilities</strong></li>
      <li><a href="/docs/sdk/capabilities">Capabilities</a></li>
      <li><a href="/docs/sdk/functions">Functions</a></li>
      <li><a href="/docs/sdk/rate-limit">Rate Limiting</a></li>
    </ul>
  </nav>
  <main>
    <div class="breadcrumb">
      <a href="/docs">Docs</a> &gt; <a href="/docs/sdk">SDK</a> &gt; ${page.title}
    </div>
    ${page.content}
  </main>
</body>
</html>`
}

function generateThingPageContent(): string {
  return `
    <h1>Thing</h1>
    <p>The <code>Thing</code> interface is the base entity type in dotdo. Every entity in the system extends from Thing, which provides URL-based identity and standard CRUD operations.</p>

    <section>
      <h2><a href="/docs/sdk/ThingData">ThingData</a> Interface</h2>
      <p>The data portion of a Thing, containing core fields and git provenance.</p>
      <table class="type-table">
        <thead>
          <tr><th>Property</th><th>Type</th><th>Required</th><th>Default</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>$id</code></td><td>string</td><td>*</td><td>-</td><td>Fully qualified URL identity</td></tr>
          <tr><td><code>$type</code></td><td>string</td><td>*</td><td>-</td><td>Type URL (Noun URL)</td></tr>
          <tr><td><code>name</code></td><td>string</td><td>optional</td><td>undefined</td><td>Display name</td></tr>
          <tr><td><code>data</code></td><td>Record&lt;string, unknown&gt;</td><td>optional</td><td>{}</td><td>Custom data fields</td></tr>
          <tr><td><code>meta</code></td><td>Record&lt;string, unknown&gt;</td><td>optional</td><td>{}</td><td>Metadata</td></tr>
          <tr><td><code>$source</code></td><td>{repo, path, branch, commit}</td><td>optional</td><td>undefined</td><td>Git provenance</td></tr>
          <tr><td><code>createdAt</code></td><td>Date</td><td>*</td><td>now()</td><td>Creation timestamp</td></tr>
          <tr><td><code>updatedAt</code></td><td>Date</td><td>*</td><td>now()</td><td>Last update timestamp</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Thing Interface</h2>
      <p>The full Thing interface extends <a href="/docs/sdk/ThingData">ThingData</a> with identity helpers, relationships, and operations.</p>
      <table class="type-table">
        <thead>
          <tr><th>Property</th><th>Type</th><th>Default</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>identity</code></td><td>ThingIdentity</td><td>-</td><td>Computed identity from $id</td></tr>
          <tr><td><code>isDO</code></td><td>boolean</td><td>false</td><td>Whether this Thing is a DO</td></tr>
          <tr><td><code>relationships</code></td><td>Record&lt;string, Thing | Thing[]&gt;</td><td>{}</td><td>Outbound edges by verb</td></tr>
          <tr><td><code>references</code></td><td>Record&lt;string, Thing | Thing[]&gt;</td><td>{}</td><td>Inbound edges by reverse verb</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Operations</h2>
      <table>
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>update</code></td><td>(data: Partial&lt;ThingData&gt;) =&gt; RpcPromise&lt;Thing&gt;</td><td>Update this Thing</td></tr>
          <tr><td><code>delete</code></td><td>() =&gt; RpcPromise&lt;void&gt;</td><td>Delete this Thing</td></tr>
          <tr><td><code>promote</code></td><td>() =&gt; RpcPromise&lt;ThingDO&gt;</td><td>Promote to its own DO</td></tr>
          <tr><td><code>relate</code></td><td>(verb: string, to: string | Thing) =&gt; RpcPromise&lt;void&gt;</td><td>Create a relationship</td></tr>
          <tr><td><code>unrelate</code></td><td>(verb: string, to: string | Thing) =&gt; RpcPromise&lt;void&gt;</td><td>Remove a relationship</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>ThingDO Interface</h2>
      <p>A Thing that has been promoted to its own Durable Object (namespace). Extends Thing with <code>isDO: true</code>.</p>
      <table class="type-table">
        <thead>
          <tr><th>Property</th><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>isDO</code></td><td>true</td><td>Always true for ThingDO</td></tr>
          <tr><td><code>$git</code></td><td>object</td><td>Git binding information</td></tr>
          <tr><td><code>$parent</code></td><td>ThingDO</td><td>Parent DO relationship</td></tr>
          <tr><td><code>$children</code></td><td>ThingDO[]</td><td>Child DOs</td></tr>
        </tbody>
      </table>
      <p>Methods: <code>collection&lt;T&gt;(noun: string): Things&lt;T&gt;</code> - Get a collection of Things by noun</p>
    </section>

    <section>
      <h2>Usage Examples</h2>
      <pre><code>// Access a Thing's identity
const thing: Thing = await $.Thing('user-123')
console.log(thing.$id) // 'https://example.com/user-123'

// Update a Thing
await thing.update({ name: 'New Name' })

// Create relationships
await thing.relate('manages', 'https://example.com/project-456')

// Promote to ThingDO
const thingDO = await thing.promote()
const users = thingDO.collection('User')</code></pre>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/things">Things</a>, <a href="/docs/sdk/workflow-context">WorkflowContext</a></p>
    </section>
  `
}

function generateThingsPageContent(): string {
  return `
    <h1>Things</h1>
    <p>The <code>Things&lt;T&gt;</code> interface provides a collection interface for managing groups of Thing entities. It supports CRUD operations, querying, and iteration.</p>

    <section>
      <h2>Overview</h2>
      <p>Things collections are accessed via ThingDO namespaces and provide typed access to entities.</p>
      <table class="type-table">
        <thead>
          <tr><th>Property</th><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>T</code></td><td>extends Thing</td><td>Generic type parameter for typed collections</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Usage Examples</h2>
      <pre><code>// Get a collection from a ThingDO
const startups = thingDO.collection&lt;Startup&gt;('Startup')

// Create a new entity
const newStartup = await startups.create({
  name: 'Acme Corp',
  data: { founded: 2024 }
})

// Iterate over entities
for await (const startup of startups) {
  console.log(startup.name)
}</code></pre>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/thing">Thing</a>, <a href="/docs/sdk/thing#thingdo-interface">ThingDO</a></p>
    </section>
  `
}

function generateWorkflowContextPageContent(): string {
  return `
    <h1>WorkflowContext</h1>
    <p>The <code>WorkflowContext</code> interface (commonly accessed as <code>$</code>) is the unified interface for all Durable Object operations.</p>

    <section>
      <h2>Execution Modes</h2>
      <table class="type-table">
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>send</code></td><td>(event: string, data: unknown) =&gt; void</td><td>Fire-and-forget event emission</td></tr>
          <tr><td><code>try</code></td><td>&lt;T&gt;(action: string, data: unknown) =&gt; Promise&lt;T&gt;</td><td>Quick attempt without durability</td></tr>
          <tr><td><code>do</code></td><td>&lt;T&gt;(action: string, data: unknown) =&gt; Promise&lt;T&gt;</td><td>Durable execution with retries</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Event Subscriptions</h2>
      <p>Subscribe to domain events using the fluent <code>$.on</code> proxy:</p>
      <pre><code>// Subscribe to Customer created events
$.on.Customer.created(async (event) => {
  console.log('New customer:', event.data)
})</code></pre>
    </section>

    <section>
      <h2>Scheduling</h2>
      <p>Schedule recurring tasks using the <code>$.every</code> builder:</p>
      <pre><code>// Run every Monday at 9am
$.every.Monday.at9am(async () => {
  await generateWeeklyReport()
})

// Natural language scheduling
$.every('daily at 6am', async () => {
  await runBackup()
})</code></pre>
    </section>

    <section>
      <h2>Domain Resolution</h2>
      <p>Resolve and call methods on other DOs:</p>
      <pre><code>// Call methods on a Startup entity
const startup = $.Startup('acme')
await startup.prioritize()</code></pre>
    </section>

    <section>
      <h2>Type Helpers</h2>
      <table class="type-table">
        <thead>
          <tr><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>WithFs</code></td><td>WorkflowContext &amp; { fs: FsCapability }</td></tr>
          <tr><td><code>WithGit</code></td><td>WorkflowContext &amp; { git: GitCapability }</td></tr>
          <tr><td><code>WithBash</code></td><td>WorkflowContext &amp; { bash: BashCapability }</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/thing">Thing</a>, <a href="/docs/sdk/capabilities">Capabilities</a>, <a href="/docs/sdk/functions">Functions</a></p>
    </section>
  `
}

function generateCapabilitiesPageContent(): string {
  return `
    <h1>Capabilities</h1>
    <p>Capability modules provide domain-specific functionality to workflows through the WorkflowContext ($).</p>

    <section>
      <h2>FsCapability</h2>
      <p>Filesystem capability for workflows that need file access.</p>
      <table class="type-table">
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>readFile</code></td><td>(path: string) =&gt; Promise&lt;string | Buffer&gt;</td><td>Read file contents</td></tr>
          <tr><td><code>writeFile</code></td><td>(path: string, content: string | Buffer) =&gt; Promise&lt;void&gt;</td><td>Write content to file</td></tr>
          <tr><td><code>readDir</code></td><td>(path: string) =&gt; Promise&lt;string[]&gt;</td><td>List directory contents</td></tr>
          <tr><td><code>exists</code></td><td>(path: string) =&gt; Promise&lt;boolean&gt;</td><td>Check if path exists</td></tr>
          <tr><td><code>mkdir</code></td><td>(path: string, options?) =&gt; Promise&lt;void&gt;</td><td>Create directory</td></tr>
          <tr><td><code>rm</code></td><td>(path: string, options?) =&gt; Promise&lt;void&gt;</td><td>Remove file or directory</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>GitCapability</h2>
      <p>Git capability for workflows that need version control.</p>
      <table class="type-table">
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>status</code></td><td>() =&gt; Promise&lt;GitStatus&gt;</td><td>Get repository status</td></tr>
          <tr><td><code>add</code></td><td>(files: string | string[]) =&gt; Promise&lt;void&gt;</td><td>Stage files for commit</td></tr>
          <tr><td><code>commit</code></td><td>(message: string) =&gt; Promise&lt;string | {hash: string}&gt;</td><td>Create a commit</td></tr>
          <tr><td><code>push</code></td><td>(remote?, branch?) =&gt; Promise&lt;void&gt;</td><td>Push to remote</td></tr>
          <tr><td><code>pull</code></td><td>(remote?, branch?) =&gt; Promise&lt;void&gt;</td><td>Pull from remote</td></tr>
          <tr><td><code>log</code></td><td>(options?) =&gt; Promise&lt;GitCommit[]&gt;</td><td>Get commit history</td></tr>
          <tr><td><code>diff</code></td><td>(ref?) =&gt; Promise&lt;string&gt;</td><td>Get diff output</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>BashCapability</h2>
      <p>Bash capability for workflows that need shell access.</p>
      <table class="type-table">
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>exec</code></td><td>(command: string, options?) =&gt; Promise&lt;ExecResult&gt;</td><td>Execute command and wait</td></tr>
          <tr><td><code>spawn</code></td><td>(command: string, args?) =&gt; SpawnedProcess</td><td>Spawn child process</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Type Guards</h2>
      <pre><code>// Check for filesystem capability
if (hasFs($)) {
  await $.fs.readFile('/data.json')
}

// Check for git capability
if (hasGit($)) {
  const status = await $.git.status()
}

// Check for bash capability
if (hasBash($)) {
  await $.bash.exec('echo hello')
}</code></pre>
    </section>

    <section>
      <h2>CapabilityError</h2>
      <p class="remarks">Error thrown when a capability is not available.</p>
      <pre><code>throw new CapabilityError(
  'fs',
  'not_available',
  'Filesystem capability is required'
)</code></pre>
      <p>Reasons: <code>not_available</code>, <code>permission_denied</code>, <code>load_failed</code></p>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/workflow-context">WorkflowContext</a></p>
    </section>
  `
}

function generateFunctionsPageContent(): string {
  return `
    <h1>DOFunction<Output, Input, Options></h1>
    <p>The <code>DOFunction<T></code> type is the generic function signature for all DO methods.</p>

    <section>
      <h2>Type Parameters</h2>
      <p>Generic type parameters: <code><Output, Input = unknown, Options extends Record<string, unknown>></code></p>
      <table class="type-table">
        <thead>
          <tr><th>Parameter</th><th>Constraint</th><th>Default</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code><Output></code></td><td>-</td><td>-</td><td>Return type of the function</td></tr>
          <tr><td><code><Input></code></td><td>-</td><td>unknown</td><td>Input parameter type</td></tr>
          <tr><td><code><Options></code></td><td>extends Record&lt;string, unknown&gt;</td><td>Record&lt;string, unknown&gt;</td><td>Additional options type</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Signature</h2>
      <pre><code>type DOFunction&lt;
  Output,
  Input = unknown,
  Options extends Record&lt;string, unknown&gt; = Record&lt;string, unknown&gt;
&gt; = (input: Input, options?: Options) =&gt; Promise&lt;Output&gt;</code></pre>
    </section>

    <section>
      <h2>Usage Examples</h2>
      <pre><code>// A simple DO function
const greet: DOFunction&lt;string, { name: string }&gt; = async (input) => {
  return \`Hello, \${input.name}!\`
}

// Function with options parameter
const fetchData: DOFunction&lt;
  Data[],
  { query: string },
  { limit?: number; offset?: number }
&gt; = async (input, options) => {
  const limit = options?.limit ?? 10
  return query(input.query, { limit })
}</code></pre>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/workflow-context">WorkflowContext</a>, <a href="/docs/sdk/thing">Thing</a></p>
    </section>
  `
}

function generateRateLimitPageContent(): string {
  return `
    <h1>Rate Limiting</h1>
    <p>Rate limiting types for controlling access and preventing abuse.</p>

    <section>
      <h2>RateLimitResult</h2>
      <p>Result from rate limit check/consume operations.</p>
      <table class="type-table">
        <thead>
          <tr><th>Property</th><th>Type</th><th>Required</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>success</code></td><td>boolean</td><td>*</td><td>Whether the action is allowed</td></tr>
          <tr><td><code>remaining</code></td><td>number</td><td>*</td><td>Remaining quota in the current window</td></tr>
          <tr><td><code>resetAt</code></td><td>number</td><td>optional</td><td>When the limit resets (epoch ms)</td></tr>
          <tr><td><code>limit</code></td><td>number</td><td>optional</td><td>Limit that was checked</td></tr>
        </tbody>
      </table>
      <p class="remarks note">Additional notes about rate limit behavior may apply.</p>
    </section>

    <section>
      <h2>RateLimitCapability</h2>
      <table class="type-table">
        <thead>
          <tr><th>Method</th><th>Signature</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>check</code></td><td>(key: string, options?) =&gt; Promise&lt;RateLimitResult&gt;</td><td>Check if action is rate limited</td></tr>
          <tr><td><code>consume</code></td><td>(key: string, cost?) =&gt; Promise&lt;RateLimitResult&gt;</td><td>Consume rate limit quota</td></tr>
          <tr><td><code>status</code></td><td>(key: string) =&gt; Promise&lt;RateLimitResult&gt;</td><td>Get current quota status</td></tr>
          <tr><td><code>reset</code></td><td>(key: string) =&gt; Promise&lt;void&gt;</td><td>Reset rate limit for a key</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Usage Example</h2>
      <pre><code>const handleRequest = async ($: WorkflowContext, userId: string) => {
  if (!hasRateLimit($)) {
    throw new Error('Rate limiting not available')
  }

  const result = await $.rateLimit.check(userId, {
    limit: 100,
    windowMs: 60000 // 1 minute
  })

  if (!result.success) {
    throw new Error('Rate limited')
  }

  await $.rateLimit.consume(userId)
}</code></pre>
    </section>

    <section>
      <h2>Related Types</h2>
      <p>See also: <a href="/docs/sdk/workflow-context">WorkflowContext</a>, <a href="/docs/sdk/capabilities">Capabilities</a></p>
    </section>
  `
}

function generateSdk404Html(pageName: string): string {
  // Find similar pages
  const allPages = ['thing', 'things', 'workflow-context', 'capabilities', 'functions', 'rate-limit']
  const similar = allPages.filter((p) => p.includes(pageName.toLowerCase()) || pageName.toLowerCase().includes(p))

  const suggestions = similar.length > 0 ? `<p>Did you mean: ${similar.map((p) => `<a href="/docs/sdk/${p}">${p}</a>`).join(', ')}?</p>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Page Not Found - SDK Reference - dotdo</title>
</head>
<body>
  <h1>404 - Page Not Found</h1>
  <p>The SDK documentation page "${pageName}" was not found.</p>
  ${suggestions}
  <p>Similar pages you might be looking for: <a href="/docs/sdk/thing">Thing</a>, <a href="/docs/sdk/workflow-context">WorkflowContext</a></p>
  <p><a href="/docs/sdk">Back to SDK Documentation</a></p>
</body>
</html>`
}

export default { renderDocsPage }
