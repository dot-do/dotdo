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

export default { renderDocsPage }
