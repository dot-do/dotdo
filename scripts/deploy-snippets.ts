#!/usr/bin/env npx tsx
/**
 * Batch Deploy Snippets to workers.do Zone
 *
 * Deploys all production snippets in a single command.
 *
 * Usage:
 *   npx tsx scripts/deploy-snippets.ts           # Deploy all snippets
 *   npx tsx scripts/deploy-snippets.ts --dry     # Show what would be deployed
 *   npx tsx scripts/deploy-snippets.ts --list    # List configured snippets
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

// ============================================================================
// SNIPPET CONFIGURATION
// ============================================================================

/**
 * Snippets to deploy with their route patterns.
 *
 * Pattern syntax:
 *   - /*              All paths
 *   - /api/*          Path prefix
 *   - /$.search?q=    Exact path + query param
 *   - ?q=             Any path with query param
 */
interface SnippetConfig {
  /** Name of the snippet in Cloudflare */
  name: string
  /** Path to the source file (relative to project root) */
  file: string
  /** Route pattern to enable the snippet */
  pattern: string
  /** Description for logging */
  description?: string
  /** Whether this snippet is enabled by default */
  enabled?: boolean
}

/**
 * Whether to use minified snippets (from dist/snippets-min/).
 * Set to false to deploy source files directly (for debugging).
 */
const USE_MINIFIED = true

/**
 * Get the file path for a snippet, using minified version if available.
 */
function getSnippetPath(name: string): string {
  if (USE_MINIFIED) {
    return `dist/snippets-min/${name}.min.js`
  }
  return `snippets/${name}.ts`
}

const SNIPPETS: SnippetConfig[] = [
  {
    name: 'proxy',
    file: getSnippetPath('proxy'),
    pattern: '/*',
    description: 'Main proxy handler for all requests',
    enabled: true,
  },
  {
    name: 'cache',
    file: getSnippetPath('cache'),
    pattern: '/api/*',
    description: 'Cache layer for API responses',
    enabled: false, // Enable manually when ready
  },
  {
    name: 'search',
    file: getSnippetPath('search'),
    pattern: '/$.search?q=',
    description: 'Full-text search handler',
    enabled: false,
  },
  {
    name: 'events',
    file: getSnippetPath('events'),
    pattern: '/events/*',
    description: 'Event streaming endpoint',
    enabled: false,
  },
  {
    name: 'artifacts-serve',
    file: getSnippetPath('artifacts-serve'),
    pattern: '/artifacts/*',
    description: 'Artifact serving from R2/Iceberg',
    enabled: false,
  },
  {
    name: 'artifacts-ingest',
    file: getSnippetPath('artifacts-ingest'),
    pattern: '/api/artifacts/*',
    description: 'Artifact ingestion via Pipelines',
    enabled: false,
  },
]

// ============================================================================
// ENVIRONMENT
// ============================================================================

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

// ============================================================================
// API HELPERS
// ============================================================================

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

// ============================================================================
// DEPLOYMENT FUNCTIONS
// ============================================================================

async function deploySnippet(config: SnippetConfig): Promise<void> {
  const fullPath = resolve(__dirname, '..', config.file)

  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`)
  }

  const code = readFileSync(fullPath, 'utf-8')
  const mainModule = 'snippet.js'

  const form = new FormData()
  form.append('metadata', JSON.stringify({ main_module: mainModule }))
  form.append(mainModule, new Blob([code], { type: 'application/javascript' }), mainModule)

  interface Result {
    snippet_name: string
    modified_on: string
  }

  await request<Result>(config.name, {
    method: 'PUT',
    body: form,
  })
}

function convertPatternToExpression(pattern: string): string {
  if (pattern.startsWith('http.')) {
    return pattern
  }

  if (pattern.includes('?')) {
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

    return conditions.join(' and ')
  }

  const regex = pattern.replace(/\./g, '\\.').replace(/\$/g, '\\$').replace(/\*/g, '.*')
  return `http.request.uri.path matches "^${regex}$"`
}

async function enableSnippets(configs: SnippetConfig[]): Promise<void> {
  const enabledConfigs = configs.filter((c) => c.enabled)
  if (enabledConfigs.length === 0) {
    console.log('No snippets configured for auto-enable')
    return
  }

  const rules = enabledConfigs.map((config) => ({
    snippet_name: config.name,
    enabled: true,
    expression: convertPatternToExpression(config.pattern),
    description: config.description || `Enable ${config.name} for ${config.pattern}`,
  }))

  const rulesUrl = `${BASE_URL}/snippet_rules`
  const rulesResponse = await fetch(rulesUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rules }),
  })

  const rulesData = (await rulesResponse.json()) as CloudflareResponse<unknown>
  if (!rulesResponse.ok || !rulesData.success) {
    const errors = rulesData.errors?.map((e) => e.message).join(', ') || 'Unknown error'
    throw new Error(`Rules API error (${rulesResponse.status}): ${errors}`)
  }
}

// ============================================================================
// COMMANDS
// ============================================================================

async function listSnippets(): Promise<void> {
  console.log('Configured snippets:\n')

  const maxNameLen = Math.max(...SNIPPETS.map((s) => s.name.length))
  const maxPatternLen = Math.max(...SNIPPETS.map((s) => s.pattern.length))

  for (const snippet of SNIPPETS) {
    const status = snippet.enabled ? '[enabled]' : '[manual]'
    const name = snippet.name.padEnd(maxNameLen)
    const pattern = snippet.pattern.padEnd(maxPatternLen)
    console.log(`  ${status.padEnd(10)} ${name}  ${pattern}  ${snippet.file}`)
  }

  console.log('\nTo deploy all: npx tsx scripts/deploy-snippets.ts')
  console.log('To dry-run:    npx tsx scripts/deploy-snippets.ts --dry')
}

async function dryRun(): Promise<void> {
  console.log('DRY RUN - Would deploy the following snippets:\n')

  for (const snippet of SNIPPETS) {
    const fullPath = resolve(__dirname, '..', snippet.file)
    const exists = existsSync(fullPath) ? 'OK' : 'MISSING'
    const enabled = snippet.enabled ? 'auto-enable' : 'manual-enable'

    console.log(`  ${snippet.name}`)
    console.log(`    File: ${snippet.file} [${exists}]`)
    console.log(`    Pattern: ${snippet.pattern}`)
    console.log(`    Enable: ${enabled}`)
    console.log()
  }

  console.log('To deploy for real, run without --dry flag')
}

async function deployAll(): Promise<void> {
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

  console.log('Deploying snippets to workers.do zone...\n')

  const results: Array<{ name: string; success: boolean; error?: string }> = []

  for (const snippet of SNIPPETS) {
    process.stdout.write(`  Deploying ${snippet.name}... `)
    try {
      await deploySnippet(snippet)
      console.log('OK')
      results.push({ name: snippet.name, success: true })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.log(`FAILED: ${error}`)
      results.push({ name: snippet.name, success: false, error })
    }
  }

  console.log('\nEnabling snippet rules...')
  try {
    await enableSnippets(SNIPPETS)
    console.log('  Rules configured successfully')
  } catch (e) {
    console.log(`  Failed to configure rules: ${e instanceof Error ? e.message : e}`)
  }

  // Summary
  console.log('\n--- Summary ---')
  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  console.log(`  Deployed: ${successful}/${results.length}`)
  if (failed > 0) {
    console.log(`  Failed: ${failed}`)
    for (const r of results.filter((r) => !r.success)) {
      console.log(`    - ${r.name}: ${r.error}`)
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Batch Deploy Snippets to workers.do Zone

Usage:
  npx tsx scripts/deploy-snippets.ts           Deploy all snippets
  npx tsx scripts/deploy-snippets.ts --dry     Show what would be deployed
  npx tsx scripts/deploy-snippets.ts --list    List configured snippets

Environment:
  CF_API_TOKEN  Cloudflare API token (Zone.Snippets permission)
  CF_ZONE_ID    workers.do zone ID
`)
} else if (args.includes('--list') || args.includes('-l')) {
  await listSnippets()
} else if (args.includes('--dry') || args.includes('-d')) {
  await dryRun()
} else {
  await deployAll()
}
