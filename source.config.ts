import { defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import { createOpenAPI } from 'fumadocs-openapi/server'

export const { docs, meta } = defineDocs({
  dir: 'docs',
})

// OpenAPI documentation configuration
export const openapi = createOpenAPI({
  // Path to the OpenAPI spec file or URL
  // In production, this would be generated from the API routes
  generateCodeSamples(endpoint) {
    return [
      {
        lang: 'curl',
        label: 'cURL',
        source: generateCurlSample(endpoint),
      },
      {
        lang: 'javascript',
        label: 'JavaScript',
        source: generateJsSample(endpoint),
      },
      {
        lang: 'typescript',
        label: 'TypeScript',
        source: generateTsSample(endpoint),
      },
      {
        lang: 'python',
        label: 'Python',
        source: generatePythonSample(endpoint),
      },
    ]
  },
})

// Code sample generators
function generateCurlSample(endpoint: { method: string; path: string; requestBody?: { content?: Record<string, { schema?: unknown }> }; security?: Array<Record<string, string[]>> }): string {
  const { method, path, requestBody, security } = endpoint
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

function generateJsSample(endpoint: { method: string; path: string; requestBody?: { content?: Record<string, { schema?: unknown }> }; security?: Array<Record<string, string[]>> }): string {
  const { method, path, requestBody, security } = endpoint
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

function generateTsSample(endpoint: { method: string; path: string; requestBody?: { content?: Record<string, { schema?: unknown }> }; security?: Array<Record<string, string[]>> }): string {
  const { method, path, requestBody, security } = endpoint
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

function generatePythonSample(endpoint: { method: string; path: string; requestBody?: { content?: Record<string, { schema?: unknown }> }; security?: Array<Record<string, string[]>> }): string {
  const { method, path, requestBody, security } = endpoint
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
