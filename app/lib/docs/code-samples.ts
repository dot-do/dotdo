/**
 * Code Sample Generation
 *
 * Generates code samples for API operations in multiple languages.
 * Used by fumadocs-openapi to display code examples in documentation.
 */

import { getOpenAPIDocument } from '../../../api/routes/openapi'

// ============================================================================
// Types
// ============================================================================

export interface CodeSample {
  language: string
  label: string
  code: string
}

interface Operation {
  method: string
  path: string
  requestBody?: {
    content?: Record<
      string,
      {
        schema?: unknown
      }
    >
  }
  security?: Array<Record<string, string[]>>
  parameters?: Array<{
    name: string
    in: string
    required?: boolean
  }>
}

// ============================================================================
// Sample Generators
// ============================================================================

/**
 * Generate code samples for an operation
 */
export function generateCodeSamples(operationId: string): CodeSample[] {
  const operation = findOperation(operationId)
  if (!operation) {
    return []
  }

  return [
    {
      language: 'bash',
      label: 'cURL',
      code: generateCurlSample(operation),
    },
    {
      language: 'javascript',
      label: 'JavaScript',
      code: generateJavaScriptSample(operation),
    },
    {
      language: 'typescript',
      label: 'TypeScript',
      code: generateTypeScriptSample(operation),
    },
    {
      language: 'python',
      label: 'Python',
      code: generatePythonSample(operation),
    },
  ]
}

/**
 * Find an operation by ID in the OpenAPI spec
 */
function findOperation(operationId: string): (Operation & { operationId: string }) | undefined {
  const spec = getOpenAPIDocument()
  const methods = ['get', 'post', 'put', 'delete', 'patch'] as const

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of methods) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | ({
            operationId?: string
          } & Operation)
        | undefined

      if (op?.operationId === operationId) {
        return {
          ...op,
          operationId,
          method,
          path,
        }
      }
    }
  }

  return undefined
}

/**
 * Generate cURL sample
 */
function generateCurlSample(operation: Operation): string {
  const { method, path, requestBody, security } = operation
  let sample = `curl -X ${method.toUpperCase()} 'https://api.dotdo.dev${path}'`

  if (security && security.length > 0) {
    sample += ` \\\n  -H 'Authorization: Bearer YOUR_TOKEN'`
  }

  if (requestBody?.content?.['application/json']) {
    sample += ` \\\n  -H 'Content-Type: application/json'`
    sample += ` \\\n  -d '{"name": "example"}'`
  }

  return sample
}

/**
 * Generate JavaScript sample
 */
function generateJavaScriptSample(operation: Operation): string {
  const { method, path, requestBody, security } = operation
  const hasBody = requestBody?.content?.['application/json']
  const hasAuth = security && security.length > 0

  let sample = `const response = await fetch('https://api.dotdo.dev${path}', {
  method: '${method.toUpperCase()}',
  headers: {
    'Content-Type': 'application/json',`

  if (hasAuth) {
    sample += `
    'Authorization': 'Bearer YOUR_TOKEN',`
  }

  sample += `
  },`

  if (hasBody) {
    sample += `
  body: JSON.stringify({
    name: 'example'
  }),`
  }

  sample += `
})

const data = await response.json()`

  return sample
}

/**
 * Generate TypeScript sample
 */
function generateTypeScriptSample(operation: Operation): string {
  const { method, path, requestBody, security } = operation
  const hasBody = requestBody?.content?.['application/json']
  const hasAuth = security && security.length > 0

  let sample = `interface Response {
  // Define your response type
}

const response = await fetch('https://api.dotdo.dev${path}', {
  method: '${method.toUpperCase()}',
  headers: {
    'Content-Type': 'application/json',`

  if (hasAuth) {
    sample += `
    'Authorization': 'Bearer YOUR_TOKEN',`
  }

  sample += `
  },`

  if (hasBody) {
    sample += `
  body: JSON.stringify({
    name: 'example'
  }),`
  }

  sample += `
})

const data: Response = await response.json()`

  return sample
}

/**
 * Generate Python sample
 */
function generatePythonSample(operation: Operation): string {
  const { method, path, requestBody, security } = operation
  const hasBody = requestBody?.content?.['application/json']
  const hasAuth = security && security.length > 0

  let sample = `import requests

`

  if (hasAuth) {
    sample += `headers = {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
}

`
  } else {
    sample += `headers = {
    'Content-Type': 'application/json'
}

`
  }

  if (hasBody) {
    sample += `data = {
    'name': 'example'
}

response = requests.${method.toLowerCase()}(
    'https://api.dotdo.dev${path}',
    headers=headers,
    json=data
)`
  } else {
    sample += `response = requests.${method.toLowerCase()}(
    'https://api.dotdo.dev${path}',
    headers=headers
)`
  }

  sample += `

print(response.json())`

  return sample
}

export default { generateCodeSamples }
