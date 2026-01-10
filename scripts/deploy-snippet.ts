#!/usr/bin/env npx tsx
/**
 * Deploy Snippet to workers.do Zone
 *
 * Usage:
 *   npx tsx scripts/deploy-snippet.ts <name> <file>
 *   npx tsx scripts/deploy-snippet.ts proxy ./snippets/proxy.ts
 *   npx tsx scripts/deploy-snippet.ts --list
 *   npx tsx scripts/deploy-snippet.ts --enable proxy "/*"
 *
 * Environment:
 *   CF_API_TOKEN  - Cloudflare API token (required)
 *   CF_ZONE_ID    - workers.do zone ID (required)
 *
 * Or create a .env file with these values.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env if exists
const envPath = resolve(__dirname, '../.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      const value = valueParts.join('=')
      if (key && value && !process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

const CF_API_TOKEN = process.env.CF_API_TOKEN
const CF_ZONE_ID = process.env.CF_ZONE_ID

if (!CF_API_TOKEN) {
  console.error('Error: CF_API_TOKEN environment variable is required')
  console.error('Get a token from: https://dash.cloudflare.com/profile/api-tokens')
  console.error('Token needs: Zone.Snippets permissions')
  process.exit(1)
}

if (!CF_ZONE_ID) {
  console.error('Error: CF_ZONE_ID environment variable is required')
  console.error('Find it in: Cloudflare Dashboard > workers.do > Overview > API section')
  process.exit(1)
}

const BASE_URL = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/snippets`

interface CloudflareResponse<T> {
  success: boolean
  errors: Array<{ code: number; message: string }>
  result: T
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path ? `${BASE_URL}/${path}` : BASE_URL
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      ...options.headers,
    },
  })

  const data = (await response.json()) as CloudflareResponse<T>

  if (!response.ok || !data.success) {
    const errors = data.errors?.map((e) => e.message).join(', ') || 'Unknown error'
    throw new Error(`API error (${response.status}): ${errors}`)
  }

  return data.result
}

async function listSnippets() {
  interface Snippet {
    snippet_name: string
    modified_on: string
  }
  const snippets = await request<Snippet[]>('')

  if (!snippets || snippets.length === 0) {
    console.log('No snippets deployed to workers.do zone')
    return
  }

  console.log('Snippets on workers.do:')
  for (const s of snippets) {
    console.log(`  ${s.snippet_name} (modified: ${new Date(s.modified_on).toLocaleString()})`)
  }
}

async function deploySnippet(name: string, filePath: string) {
  const fullPath = resolve(process.cwd(), filePath)

  if (!existsSync(fullPath)) {
    console.error(`Error: File not found: ${fullPath}`)
    process.exit(1)
  }

  console.log(`Deploying "${name}" from ${filePath}...`)

  const code = readFileSync(fullPath, 'utf-8')
  const mainModule = 'snippet.js'

  const form = new FormData()
  form.append('metadata', JSON.stringify({ main_module: mainModule }))
  form.append(mainModule, new Blob([code], { type: 'application/javascript' }), mainModule)

  interface Result {
    snippet_name: string
    modified_on: string
  }
  const result = await request<Result>(name, {
    method: 'PUT',
    body: form,
  })

  console.log(`Deployed successfully!`)
  console.log(`  Name: ${result.snippet_name}`)
  console.log(`  Modified: ${result.modified_on}`)
  console.log('')
  console.log('To enable this snippet, run:')
  console.log(`  npx tsx scripts/deploy-snippet.ts --enable ${name} "/*"`)
}

async function enableSnippet(name: string, pattern: string) {
  // Convert pattern to Cloudflare expression
  // Supports: /path?param=, ?param=, /path/*, http.request.*
  let expression: string

  if (pattern.startsWith('http.')) {
    expression = pattern
  } else if (pattern.includes('?')) {
    // Query string pattern: /path?param= or ?param=
    const [pathPart, queryPart] = pattern.split('?')
    const conditions: string[] = []

    if (pathPart) {
      if (pathPart.includes('*')) {
        const regex = pathPart.replace(/\./g, '\\.').replace(/\$/g, '\\$').replace(/\*/g, '.*')
        conditions.push(`http.request.uri.path matches "^${regex}$"`)
      } else {
        conditions.push(`http.request.uri.path eq "${pathPart}"`)
      }
    }

    if (queryPart) {
      conditions.push(`http.request.uri.query contains "${queryPart}"`)
    }

    expression = conditions.join(' and ')
  } else {
    const regex = pattern.replace(/\./g, '\\.').replace(/\$/g, '\\$').replace(/\*/g, '.*')
    expression = `http.request.uri.path matches "^${regex}$"`
  }

  console.log(`Enabling "${name}" for pattern: ${pattern}`)
  console.log(`  Expression: ${expression}`)

  interface Rule {
    snippet_name: string
    enabled: boolean
    expression: string
    description?: string
  }

  // Snippet rules are at zone level: /zones/{zone_id}/snippets/snippet_rules
  const rulesUrl = `${BASE_URL}/snippet_rules`
  const rulesResponse = await fetch(rulesUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rules: [
        {
          snippet_name: name,
          enabled: true,
          expression,
          description: `Enable ${name} for ${pattern}`,
        },
      ],
    }),
  })

  const rulesData = await rulesResponse.json()
  if (!rulesResponse.ok || !rulesData.success) {
    const errors = rulesData.errors?.map(e => e.message).join(', ') || 'Unknown error'
    throw new Error(`Rules API error (${rulesResponse.status}): ${errors}`)
  }
  const rules = rulesData.result

  console.log('Rule configured successfully!')
  console.log(`  Enabled: ${rules[0].enabled}`)
}

async function showHelp() {
  console.log(`
Deploy Snippet to workers.do Zone

Usage:
  npx tsx scripts/deploy-snippet.ts <name> <file>    Deploy a snippet
  npx tsx scripts/deploy-snippet.ts --list           List all snippets
  npx tsx scripts/deploy-snippet.ts --enable <name> <pattern>  Enable snippet

Pattern Syntax:
  /*              All paths (glob)
  /api/*          Path prefix (glob)
  /$.search?q=    Exact path + query param
  ?q=             Any path with query param
  http.host eq X  Raw Cloudflare expression

Examples:
  npx tsx scripts/deploy-snippet.ts query ./snippets/query.ts
  npx tsx scripts/deploy-snippet.ts --enable query "/$.search?q="
  npx tsx scripts/deploy-snippet.ts --enable query "?q="

Environment:
  CF_API_TOKEN  Cloudflare API token (Zone.Snippets permission)
  CF_ZONE_ID    workers.do zone ID
`)
}

// Main
const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  await showHelp()
} else if (args[0] === '--list' || args[0] === '-l') {
  await listSnippets()
} else if (args[0] === '--enable' || args[0] === '-e') {
  const [, name, pattern] = args
  if (!name || !pattern) {
    console.error('Usage: --enable <name> <pattern>')
    process.exit(1)
  }
  await enableSnippet(name, pattern)
} else {
  const [name, file] = args
  if (!name || !file) {
    console.error('Usage: <name> <file>')
    process.exit(1)
  }
  await deploySnippet(name, file)
}
