/**
 * APIPage Component
 *
 * React component for rendering API documentation pages using fumadocs-openapi.
 * Displays endpoint information with method badges, parameters, code samples, and responses.
 */

import React from 'react'

// ============================================================================
// Types
// ============================================================================

export interface APIPageProps {
  operationId: string
  method: string
  path: string
  summary?: string
  description?: string
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string, ResponseDef>
  security?: SecurityRequirement[]
  codeSamples?: CodeSample[]
}

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  schema?: { type?: string }
  description?: string
}

interface RequestBody {
  required?: boolean
  content?: Record<string, { schema?: unknown; example?: unknown }>
}

interface ResponseDef {
  description?: string
  content?: Record<string, { schema?: unknown; example?: unknown }>
}

interface SecurityRequirement {
  [scheme: string]: string[]
}

interface CodeSample {
  language: string
  label: string
  code: string
}

// ============================================================================
// Sub-components
// ============================================================================

function MethodBadge({ method }: { method: string }): React.ReactElement {
  const colors: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    PATCH: '#50e3c2',
  }

  return (
    <span
      className="fd-method-badge"
      style={{
        backgroundColor: colors[method.toUpperCase()] || '#999',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '4px',
        fontWeight: 'bold',
        fontSize: '12px',
      }}
    >
      {method.toUpperCase()}
    </span>
  )
}

function ParameterTable({ parameters }: { parameters: Parameter[] }): React.ReactElement {
  return (
    <table className="fd-param-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Location</th>
          <th>Type</th>
          <th>Required</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {parameters.map((param) => (
          <tr key={`${param.in}-${param.name}`}>
            <td>
              <code>{param.name}</code>
            </td>
            <td>{param.in}</td>
            <td>{param.schema?.type || 'string'}</td>
            <td>{param.required ? 'Yes' : 'No'}</td>
            <td>{param.description || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CodeSampleTabs({ samples }: { samples: CodeSample[] }): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState(0)

  return (
    <div className="fd-code-samples">
      <div className="fd-tabs" role="tablist">
        {samples.map((sample, index) => (
          <button
            type="button"
            key={sample.language}
            role="tab"
            aria-selected={index === activeTab}
            onClick={() => setActiveTab(index)}
            className={index === activeTab ? 'active' : ''}
          >
            {sample.label}
          </button>
        ))}
      </div>
      <pre className="fd-code-block">
        <code>{samples[activeTab]?.code || ''}</code>
      </pre>
      <button type="button" className="fd-copy-btn" onClick={() => navigator.clipboard.writeText(samples[activeTab]?.code || '')}>
        Copy
      </button>
    </div>
  )
}

function ResponseSection({ responses }: { responses: Record<string, ResponseDef> }): React.ReactElement {
  return (
    <div className="fd-responses">
      <h3>Responses</h3>
      {Object.entries(responses).map(([status, response]) => (
        <details key={status} className="fd-response" open={status === '200' || status === '201'}>
          <summary>
            <span className={`status-${status.charAt(0)}xx`}>{status}</span> - {response.description || 'Response'}
          </summary>
          {response.content?.['application/json']?.example && (
            <pre className="fd-response-example">
              <code>{JSON.stringify(response.content['application/json'].example, null, 2)}</code>
            </pre>
          )}
        </details>
      ))}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function APIPage(props: APIPageProps): React.ReactElement {
  const { operationId, method, path, summary, description, parameters = [], requestBody, responses = {}, security = [], codeSamples = [] } = props

  const isProtected = security.length > 0

  return (
    <article className="fd-api-page">
      <header>
        <h1>
          <MethodBadge method={method} /> <code>{path}</code>
        </h1>
        {summary && <p className="fd-summary">{summary}</p>}
        {isProtected && (
          <div className="fd-auth-badge">
            <span className="fd-lock-icon" role="img" aria-label="Protected">
              Protected
            </span>{' '}
            - Requires authentication
          </div>
        )}
      </header>

      {description && (
        <section className="fd-description">
          <h2>Description</h2>
          <p>{description}</p>
        </section>
      )}

      {parameters.length > 0 && (
        <section className="fd-parameters">
          <h2>Parameters</h2>
          <ParameterTable parameters={parameters} />
        </section>
      )}

      {requestBody && (
        <section className="fd-request-body">
          <h2>Request Body {requestBody.required && <span className="required">(required)</span>}</h2>
          {requestBody.content?.['application/json']?.example && (
            <pre>
              <code>{JSON.stringify(requestBody.content['application/json'].example, null, 2)}</code>
            </pre>
          )}
        </section>
      )}

      {codeSamples.length > 0 && (
        <section className="fd-code-samples">
          <h2>Code Samples</h2>
          <CodeSampleTabs samples={codeSamples} />
        </section>
      )}

      {Object.keys(responses).length > 0 && <ResponseSection responses={responses} />}
    </article>
  )
}

// Default export for ESM compatibility
export default APIPage
