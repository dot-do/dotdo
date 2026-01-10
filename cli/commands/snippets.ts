/**
 * Cloudflare Snippets CLI
 *
 * Deploy, list, and manage Cloudflare Snippets for a zone.
 *
 * Usage:
 *   do snippets list                    # List all snippets
 *   do snippets deploy <name> <file>    # Deploy a snippet
 *   do snippets delete <name>           # Delete a snippet
 *   do snippets rules <name>            # Show rules for a snippet
 *   do snippets enable <name> <pattern> # Enable snippet on URL pattern
 *
 * Environment:
 *   CF_API_TOKEN  - Cloudflare API token (required)
 *   CF_ZONE_ID    - Default zone ID (or use --zone)
 */

export const name = 'snippets'
export const description = 'Manage Cloudflare Snippets'

// ============================================================================
// Types
// ============================================================================

interface SnippetMetadata {
  main_module: string
}

interface Snippet {
  snippet_name: string
  created_on: string
  modified_on: string
}

interface SnippetRule {
  snippet_name: string
  enabled: boolean
  expression: string
  description?: string
}

interface CloudflareResponse<T> {
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: Array<{ code: number; message: string }>
  result: T
}

interface RunOptions {
  fetch?: typeof fetch
  env?: Record<string, string | undefined>
}

// ============================================================================
// API Client
// ============================================================================

class SnippetsAPI {
  private baseUrl: string
  private token: string
  private fetchFn: typeof fetch

  constructor(zoneId: string, token: string, fetchFn: typeof fetch = fetch) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/snippets`
    this.token = token
    this.fetchFn = fetchFn
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<CloudflareResponse<T>> {
    const url = path ? `${this.baseUrl}/${path}` : this.baseUrl
    const response = await this.fetchFn(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      const errors = (data as CloudflareResponse<T>).errors
        ?.map((e) => e.message)
        .join(', ')
      throw new Error(`API error (${response.status}): ${errors || response.statusText}`)
    }

    return data as CloudflareResponse<T>
  }

  async list(): Promise<Snippet[]> {
    const response = await this.request<Snippet[]>('')
    return response.result
  }

  async get(name: string): Promise<Snippet> {
    const response = await this.request<Snippet>(name)
    return response.result
  }

  async deploy(name: string, code: string, mainModule = 'snippet.js'): Promise<Snippet> {
    const metadata: SnippetMetadata = { main_module: mainModule }

    const form = new FormData()
    form.append('metadata', JSON.stringify(metadata))
    form.append(mainModule, new Blob([code], { type: 'application/javascript' }), mainModule)

    const response = await this.request<Snippet>(name, {
      method: 'PUT',
      body: form,
    })

    return response.result
  }

  async delete(name: string): Promise<void> {
    await this.request(name, { method: 'DELETE' })
  }

  async getRules(name: string): Promise<SnippetRule[]> {
    const response = await this.request<SnippetRule[]>(`${name}/rules`)
    return response.result
  }

  async setRules(name: string, rules: Omit<SnippetRule, 'snippet_name'>[]): Promise<SnippetRule[]> {
    const response = await this.request<SnippetRule[]>(`${name}/rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules.map((r) => ({ ...r, snippet_name: name }))),
    })
    return response.result
  }

  // Zone-level rules endpoint
  async getAllRules(): Promise<SnippetRule[]> {
    const url = this.baseUrl.replace('/snippets', '/snippet_rules')
    const response = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    const data = (await response.json()) as CloudflareResponse<SnippetRule[]>
    return data.result
  }
}

// ============================================================================
// Commands
// ============================================================================

async function listSnippets(api: SnippetsAPI): Promise<void> {
  const snippets = await api.list()

  if (snippets.length === 0) {
    console.log('No snippets found')
    return
  }

  console.log('Snippets:')
  for (const snippet of snippets) {
    const modified = new Date(snippet.modified_on).toLocaleDateString()
    console.log(`  ${snippet.snippet_name} (modified: ${modified})`)
  }
}

async function deploySnippet(
  api: SnippetsAPI,
  name: string,
  filePath: string,
  readFile: (path: string) => Promise<string>
): Promise<void> {
  console.log(`Deploying snippet "${name}" from ${filePath}...`)

  const code = await readFile(filePath)
  const result = await api.deploy(name, code)

  console.log(`Deployed successfully`)
  console.log(`  Name: ${result.snippet_name}`)
  console.log(`  Modified: ${result.modified_on}`)
}

async function deleteSnippet(api: SnippetsAPI, name: string): Promise<void> {
  console.log(`Deleting snippet "${name}"...`)
  await api.delete(name)
  console.log('Deleted successfully')
}

async function showRules(api: SnippetsAPI, name: string): Promise<void> {
  const rules = await api.getRules(name)

  if (rules.length === 0) {
    console.log(`No rules configured for "${name}"`)
    return
  }

  console.log(`Rules for "${name}":`)
  for (const rule of rules) {
    const status = rule.enabled ? '✓' : '✗'
    console.log(`  ${status} ${rule.expression}`)
    if (rule.description) {
      console.log(`    ${rule.description}`)
    }
  }
}

async function enableSnippet(
  api: SnippetsAPI,
  name: string,
  pattern: string,
  description?: string
): Promise<void> {
  // Convert pattern to Cloudflare expression
  // Supports:
  //   http.request.*       -> raw Cloudflare expression (pass through)
  //   /path?param=         -> path + query string match
  //   ?param=              -> query string only
  //   /path/*              -> path glob pattern
  //   $.search?q=          -> exact path with query param
  let expression: string

  if (pattern.startsWith('http.')) {
    // Already a Cloudflare expression
    expression = pattern
  } else if (pattern.includes('?')) {
    // Query string pattern: /path?param= or ?param=
    const [pathPart, queryPart] = pattern.split('?')
    const conditions: string[] = []

    if (pathPart) {
      // Escape special chars for exact or glob match
      if (pathPart.includes('*')) {
        const regex = pathPart.replace(/\./g, '\\.').replace(/\$/g, '\\$').replace(/\*/g, '.*')
        conditions.push(`http.request.uri.path matches "^${regex}$"`)
      } else {
        conditions.push(`http.request.uri.path eq "${pathPart}"`)
      }
    }

    if (queryPart) {
      // Query param check: "q=" -> query contains "q="
      conditions.push(`http.request.uri.query contains "${queryPart}"`)
    }

    expression = conditions.join(' and ')
  } else {
    // Path-only glob pattern
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\$/g, '\\$')
      .replace(/\*/g, '.*')

    expression = `http.request.uri.path matches "^${regex}$"`
  }

  console.log(`Enabling snippet "${name}" for pattern: ${pattern}`)
  console.log(`  Expression: ${expression}`)

  const rules = await api.setRules(name, [
    {
      enabled: true,
      expression,
      description: description || `Enable ${name} for ${pattern}`,
    },
  ])

  console.log('Rule configured successfully')
  console.log(`  Enabled: ${rules[0].enabled}`)
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function run(args: string[], options: RunOptions = {}): Promise<{ success: boolean }> {
  const env = options.env ?? process.env
  const fetchFn = options.fetch ?? fetch

  // Parse arguments
  const [subcommand, ...rest] = args

  // Parse flags
  let zoneId = env.CF_ZONE_ID
  const flagArgs: string[] = []

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--zone' && rest[i + 1]) {
      zoneId = rest[i + 1]
      i++ // Skip next arg
    } else if (!rest[i].startsWith('--')) {
      flagArgs.push(rest[i])
    }
  }

  // Validate environment
  const token = env.CF_API_TOKEN
  if (!token) {
    console.error('Error: CF_API_TOKEN environment variable is required')
    console.error('Get a token from: https://dash.cloudflare.com/profile/api-tokens')
    return { success: false }
  }

  if (!zoneId) {
    console.error('Error: CF_ZONE_ID environment variable or --zone flag is required')
    console.error('Find your zone ID in the Cloudflare dashboard Overview page')
    return { success: false }
  }

  const api = new SnippetsAPI(zoneId, token, fetchFn)

  // File reader (can be overridden in tests)
  const readFile = async (path: string): Promise<string> => {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  }

  try {
    switch (subcommand) {
      case 'list':
      case 'ls':
        await listSnippets(api)
        break

      case 'deploy':
      case 'push': {
        const [name, filePath] = flagArgs
        if (!name || !filePath) {
          console.error('Usage: do snippets deploy <name> <file>')
          return { success: false }
        }
        await deploySnippet(api, name, filePath, readFile)
        break
      }

      case 'delete':
      case 'rm': {
        const [name] = flagArgs
        if (!name) {
          console.error('Usage: do snippets delete <name>')
          return { success: false }
        }
        await deleteSnippet(api, name)
        break
      }

      case 'rules': {
        const [name] = flagArgs
        if (!name) {
          console.error('Usage: do snippets rules <name>')
          return { success: false }
        }
        await showRules(api, name)
        break
      }

      case 'enable': {
        const [name, pattern, description] = flagArgs
        if (!name || !pattern) {
          console.error('Usage: do snippets enable <name> <pattern> [description]')
          console.error('Examples:')
          console.error('  do snippets enable proxy "/*"')
          console.error('  do snippets enable api "/api/*"')
          return { success: false }
        }
        await enableSnippet(api, name, pattern, description)
        break
      }

      case undefined:
      case 'help':
        console.log(`
Cloudflare Snippets CLI

Usage:
  do snippets list                       List all snippets
  do snippets deploy <name> <file>       Deploy a snippet
  do snippets delete <name>              Delete a snippet
  do snippets rules <name>               Show rules for a snippet
  do snippets enable <name> <pattern>    Enable snippet on URL pattern

Pattern Syntax:
  /*              All paths (glob)
  /api/*          Path prefix (glob)
  /$.search?q=    Exact path + query param
  ?q=             Any path with query param
  http.host eq X  Raw Cloudflare expression

Options:
  --zone <id>    Override CF_ZONE_ID

Environment:
  CF_API_TOKEN   Cloudflare API token (required)
  CF_ZONE_ID     Default zone ID

Examples:
  do snippets deploy query ./snippets/query.js
  do snippets enable query "/$.search?q="
  do snippets enable query "?q=" "Search queries only"
  do snippets enable proxy "/api/*"
`)
        break

      default:
        console.error(`Unknown subcommand: ${subcommand}`)
        console.error('Run "do snippets help" for usage')
        return { success: false }
    }

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error:', message)
    return { success: false }
  }
}
