// dotdo init - Interactive project scaffolding
import { writeFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import * as readline from 'node:readline/promises'

export interface InitOptions {
  name?: string
  yes?: boolean
  template?: 'basic' | 'api' | 'full'
  skipGit?: boolean
  skipInstall?: boolean
}

interface ProjectConfig {
  name: string
  template: 'basic' | 'api' | 'full'
  features: {
    auth: boolean
    db: boolean
    ai: boolean
    mcp: boolean
  }
}

// Current date for compatibility_date
const COMPATIBILITY_DATE = new Date().toISOString().split('T')[0]

export async function init(targetDir: string = '.', options: InitOptions = {}): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    // Check if directory exists and is empty
    await checkDirectory(targetDir)

    // Get project configuration
    const config = await getProjectConfig(rl, options)

    console.log(`\nInitializing dotdo project: ${config.name}`)
    console.log(`Template: ${config.template}`)
    console.log('')

    // Create directory structure
    await createDirectoryStructure(targetDir, config)

    // Generate files
    await generatePackageJson(targetDir, config)
    await generateTsConfig(targetDir, config)
    await generateWranglerConfig(targetDir, config)
    await generateEnvTypes(targetDir, config)
    await generateEnvExample(targetDir, config)
    await generateGitignore(targetDir)
    await generateSourceFiles(targetDir, config)
    await generateTestFiles(targetDir, config)
    await generateReadme(targetDir, config)

    // Initialize git
    if (!options.skipGit) {
      await initGit(targetDir)
    }

    // Install dependencies
    if (!options.skipInstall) {
      await installDependencies(targetDir)
    }

    console.log('\n✓ Project initialized successfully!')
    console.log('\nNext steps:')
    if (targetDir !== '.') {
      console.log(`  cd ${config.name}`)
    }
    if (options.skipInstall) {
      console.log('  npm install')
    }
    console.log('  npm run dev')
    console.log('')
  } finally {
    rl.close()
  }
}

async function checkDirectory(targetDir: string): Promise<void> {
  try {
    await access(targetDir)
    // Directory exists, check if it's empty
    const { readdirSync } = await import('node:fs')
    const files = readdirSync(targetDir)
    if (files.length > 0 && !files.every((f) => f.startsWith('.'))) {
      throw new Error(`Directory ${targetDir} is not empty`)
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Directory doesn't exist, will create it
      return
    }
    throw error
  }
}

async function getProjectConfig(
  rl: readline.Interface,
  options: InitOptions
): Promise<ProjectConfig> {
  if (options.yes) {
    return {
      name: options.name || 'my-dotdo-project',
      template: options.template || 'basic',
      features: {
        auth: options.template === 'full',
        db: options.template !== 'basic',
        ai: options.template === 'full',
        mcp: options.template === 'full',
      },
    }
  }

  // Interactive prompts
  const name =
    options.name ||
    (await rl.question('Project name: (my-dotdo-project) ')) ||
    'my-dotdo-project'

  const templateInput = await rl.question(
    'Template (basic/api/full): (basic) '
  )
  const template = (templateInput || 'basic') as 'basic' | 'api' | 'full'

  // Feature selection for non-basic templates
  let features = {
    auth: false,
    db: template !== 'basic',
    ai: false,
    mcp: false,
  }

  if (template === 'full') {
    features = { auth: true, db: true, ai: true, mcp: true }
  } else if (template === 'api') {
    const addAuth = await rl.question('Include auth? (y/N) ')
    const addAI = await rl.question('Include AI module? (y/N) ')
    features.auth = addAuth.toLowerCase() === 'y'
    features.ai = addAI.toLowerCase() === 'y'
  }

  return { name, template, features }
}

async function createDirectoryStructure(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const dirs = ['src', 'tests']

  for (const dir of dirs) {
    await mkdir(join(targetDir, dir), { recursive: true })
  }
}

async function generatePackageJson(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const dependencies: Record<string, string> = {
    dotdo: '^0.0.1',
    hono: '^4.7.0',
  }

  const devDependencies: Record<string, string> = {
    '@cloudflare/workers-types': '^4.20260118.0',
    '@cloudflare/vitest-pool-workers': '^0.8.0',
    typescript: '^5.7.0',
    vitest: '^2.1.0',
    wrangler: '^4.59.0',
  }

  // Add template-specific dependencies
  if (config.features.auth) {
    dependencies['jose'] = '^5.0.0' // JWT library
  }

  if (config.features.ai) {
    // Workers AI is built-in, but add OpenAI SDK for external providers
    dependencies['openai'] = '^4.0.0'
  }

  // Scripts vary by template
  const scripts: Record<string, string> = {
    dev: 'wrangler dev',
    deploy: 'wrangler deploy',
    test: 'vitest',
    'test:run': 'vitest run',
    typecheck: 'tsc --noEmit',
  }

  if (config.template === 'full') {
    scripts['build'] = 'tsc --build'
    scripts['lint'] = 'echo "Add eslint configuration"'
  }

  const pkg = {
    name: config.name,
    version: '0.0.1',
    private: true,
    type: 'module',
    scripts,
    dependencies,
    devDependencies,
  }

  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  )
}

async function generateTsConfig(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ESNext'],
      types: ['@cloudflare/workers-types'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowSyntheticDefaultImports: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src/**/*', 'tests/**/*'],
    exclude: ['node_modules'],
  }

  await writeFile(
    join(targetDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n'
  )
}

async function generateWranglerConfig(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Build wrangler config based on template
  const wranglerLines: string[] = [
    `{`,
    `  // ${config.name} - dotdo project`,
    `  // Template: ${config.template}`,
    `  "name": "${config.name}",`,
    `  "main": "src/index.ts",`,
    `  "compatibility_date": "${COMPATIBILITY_DATE}",`,
    `  "compatibility_flags": ["nodejs_compat"],`,
    ``,
    `  // Durable Object bindings`,
    `  "durable_objects": {`,
    `    "bindings": [`,
    `      { "name": "DO", "class_name": "MyDO" }`,
  ]

  // Add API DO for api/full templates
  if (config.template === 'api' || config.template === 'full') {
    wranglerLines.push(`      // Additional DOs can be added here`)
  }

  // Check if we need trailing comments (which don't need commas in JSONC)
  const hasTrailingComments = config.template === 'api' || config.template === 'full' || config.features.ai

  wranglerLines.push(
    `    ]`,
    `  },`,
    ``,
    `  // SQLite migrations for Durable Objects`,
    `  "migrations": [`,
    `    {`,
    `      "tag": "v1",`,
    `      "new_sqlite_classes": ["MyDO"]`,
    `    }`,
    `  ]${hasTrailingComments ? '' : ''}`
  )

  // Add environment variables section for api/full templates (as comments)
  if (config.template === 'api' || config.template === 'full') {
    wranglerLines.push(
      ``,
      `  // Environment variables (use .dev.vars for local secrets)`,
      `  // "vars": {`,
      `  //   "ENVIRONMENT": "development"`,
      `  // }`
    )
  }

  // Add AI binding for full template (as comments)
  if (config.features.ai) {
    wranglerLines.push(
      ``,
      `  // AI binding (Cloudflare Workers AI)`,
      `  // "ai": {`,
      `  //   "binding": "AI"`,
      `  // }`
    )
  }

  wranglerLines.push(`}`)

  await writeFile(
    join(targetDir, 'wrangler.jsonc'),
    wranglerLines.join('\n') + '\n'
  )
}

async function generateEnvTypes(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const lines: string[] = [
    `// Environment types for ${config.name}`,
    `// Generated by dotdo init --template=${config.template}`,
    ``,
    `/// <reference types="@cloudflare/workers-types" />`,
    ``,
    `import type { MyDO } from './do'`,
    ``,
    `declare global {`,
    `  interface Env {`,
    `    // Durable Object bindings`,
    `    DO: DurableObjectNamespace<MyDO>`,
  ]

  if (config.features.auth) {
    lines.push(
      ``,
      `    // Authentication secrets (set in .dev.vars or Workers dashboard)`,
      `    JWT_SECRET?: string`,
      `    AUTH_PROVIDER_CLIENT_ID?: string`,
      `    AUTH_PROVIDER_CLIENT_SECRET?: string`
    )
  }

  if (config.features.ai) {
    lines.push(
      ``,
      `    // AI bindings`,
      `    AI?: Ai`
    )
  }

  lines.push(
    ``,
    `    // Environment variables`,
    `    ENVIRONMENT?: string`,
    `  }`,
    `}`,
    ``,
    `export {}`
  )

  await writeFile(join(targetDir, 'src', 'env.d.ts'), lines.join('\n') + '\n')
}

async function generateEnvExample(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const lines: string[] = [
    `# ${config.name} - Environment Variables`,
    `# Copy this file to .dev.vars for local development`,
    `# For production, set these in the Cloudflare Workers dashboard`,
    ``,
    `# General`,
    `ENVIRONMENT=development`
  ]

  if (config.features.auth) {
    lines.push(
      ``,
      `# Authentication`,
      `JWT_SECRET=your-super-secret-jwt-key-change-in-production`,
      `# AUTH_PROVIDER_CLIENT_ID=your-oauth-client-id`,
      `# AUTH_PROVIDER_CLIENT_SECRET=your-oauth-client-secret`
    )
  }

  if (config.features.ai) {
    lines.push(
      ``,
      `# AI (Workers AI is automatically available, no key needed)`,
      `# For external providers:`,
      `# OPENAI_API_KEY=sk-...`,
      `# ANTHROPIC_API_KEY=sk-ant-...`
    )
  }

  lines.push(
    ``,
    `# Database (SQLite is built into Durable Objects)`,
    `# For external databases:`,
    `# DATABASE_URL=postgres://...`
  )

  await writeFile(join(targetDir, '.env.example'), lines.join('\n') + '\n')
}

async function generateGitignore(targetDir: string): Promise<void> {
  const content = `# Dependencies
node_modules/

# Build
dist/
.wrangler/

# Logs
*.log

# Environment
.env
.env.local
.dev.vars

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
`

  await writeFile(join(targetDir, '.gitignore'), content)
}

async function generateSourceFiles(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Generate based on template type
  switch (config.template) {
    case 'basic':
      await generateBasicTemplate(targetDir, config)
      break
    case 'api':
      await generateApiTemplate(targetDir, config)
      break
    case 'full':
      await generateFullTemplate(targetDir, config)
      break
  }
}

// ============================================================================
// Basic Template - Minimal DO with basic routes
// ============================================================================
async function generateBasicTemplate(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Generate DO class
  const doClass = `import { DO } from 'dotdo/do'
import type { Hono } from 'hono'

/**
 * MyDO - Your Durable Object
 *
 * A Durable Object with built-in:
 * - SQLite storage (this.things, this.events, this.relationships)
 * - Hono routing (this.app)
 * - WebSocket support (this.ws)
 */
export class MyDO extends DO {
  protected routes(app: Hono): void {
    // Health check is already at GET /

    // Custom route
    app.get('/hello', (c) => {
      return c.json({ message: 'Hello from MyDO!' })
    })

    // Example: Create a thing using built-in entity store
    app.post('/things', async (c) => {
      const body = await c.req.json()
      const thing = await this.things.create({
        $type: 'Item',
        ...body,
      })
      return c.json({ success: true, data: thing })
    })

    // Example: Get all things of a type
    app.get('/things', async (c) => {
      const items = await this.things.list({ $type: 'Item' })
      return c.json({ data: items })
    })

    // Example: Get a specific thing
    app.get('/things/:id', async (c) => {
      const id = c.req.param('id')
      const thing = await this.things.get(id)
      if (!thing) {
        return c.json({ error: 'Not found' }, 404)
      }
      return c.json({ data: thing })
    })
  }
}
`

  await writeFile(join(targetDir, 'src', 'do.ts'), doClass)

  // Generate worker entry point
  const indexContent = `/// <reference path="./env.d.ts" />
import { MyDO } from './do'

// Export the Durable Object class for wrangler
export { MyDO }

/**
 * Worker entry point
 *
 * This is a minimal passthrough worker. All business logic lives in the DO.
 * The worker extracts the namespace from the subdomain and forwards requests.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Extract namespace from subdomain: tenant.example.com -> tenant
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const namespace = hostParts.length > 2 ? hostParts[0] : 'default'

    // Get DO instance by namespace
    const id = env.DO.idFromName(namespace)
    const stub = env.DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
`

  await writeFile(join(targetDir, 'src', 'index.ts'), indexContent)
}

// ============================================================================
// API Template - Full API with CRUD, validation, and optional auth
// ============================================================================
async function generateApiTemplate(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Generate DO class with more features
  const doClass = `import { DO } from 'dotdo/do'
import type { Hono, Context } from 'hono'
${config.features.auth ? `import { jwt } from 'hono/jwt'` : ''}

/**
 * MyDO - API Durable Object
 *
 * Features:
 * - RESTful CRUD operations
 * - Built-in entity storage with SQLite
 * - Event logging
 * ${config.features.auth ? '- JWT authentication' : ''}
 */
export class MyDO extends DO {
  protected routes(app: Hono): void {
${config.features.auth ? `
    // Protected routes require authentication
    app.use('/api/*', async (c, next) => {
      const jwtMiddleware = jwt({
        secret: (c.env as Env).JWT_SECRET || 'development-secret',
      })
      return jwtMiddleware(c, next)
    })
` : ''}
    // ========================================================================
    // Items API
    // ========================================================================

    // List items with optional filtering
    app.get('/api/items', async (c) => {
      const type = c.req.query('type') || 'Item'
      const limit = parseInt(c.req.query('limit') || '100')
      const offset = parseInt(c.req.query('offset') || '0')

      const items = await this.things.list({
        $type: type,
        limit,
        offset,
      })

      return c.json({
        data: items,
        meta: { type, limit, offset },
      })
    })

    // Get single item
    app.get('/api/items/:id', async (c) => {
      const id = c.req.param('id')
      const item = await this.things.get(id)

      if (!item) {
        return c.json({ error: 'Not found' }, 404)
      }

      return c.json({ data: item })
    })

    // Create item
    app.post('/api/items', async (c) => {
      const body = await c.req.json()

      // Validate required fields
      if (!body.$type) {
        return c.json({ error: 'Missing required field: $type' }, 400)
      }

      const item = await this.things.create(body)

      // Log the creation event
      await this.events.create({
        type: \`\${body.$type}.created\`,
        payload: { itemId: item.$id },
      })

      return c.json({ data: item }, 201)
    })

    // Update item
    app.put('/api/items/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json()

      const existing = await this.things.get(id)
      if (!existing) {
        return c.json({ error: 'Not found' }, 404)
      }

      const updated = await this.things.update(id, body)

      // Log the update event
      await this.events.create({
        type: \`\${existing.$type}.updated\`,
        payload: { itemId: id, changes: body },
      })

      return c.json({ data: updated })
    })

    // Delete item
    app.delete('/api/items/:id', async (c) => {
      const id = c.req.param('id')

      const existing = await this.things.get(id)
      if (!existing) {
        return c.json({ error: 'Not found' }, 404)
      }

      await this.things.delete(id)

      // Log the deletion event
      await this.events.create({
        type: \`\${existing.$type}.deleted\`,
        payload: { itemId: id },
      })

      return c.json({ success: true })
    })

    // ========================================================================
    // Events API
    // ========================================================================

    // List events
    app.get('/api/events', async (c) => {
      const type = c.req.query('type')
      const limit = parseInt(c.req.query('limit') || '100')

      const events = await this.events.list({
        type,
        limit,
      })

      return c.json({ data: events })
    })

    // ========================================================================
    // Health & Info
    // ========================================================================

    app.get('/health', (c) => {
      return c.json({
        status: 'healthy',
        id: this.state.id.toString(),
        timestamp: new Date().toISOString(),
      })
    })
  }
}
`

  await writeFile(join(targetDir, 'src', 'do.ts'), doClass)

  // Generate worker entry point with more robust routing
  const indexContent = `/// <reference path="./env.d.ts" />
import { MyDO } from './do'

// Export the Durable Object class for wrangler
export { MyDO }

/**
 * Worker entry point for API template
 *
 * Routes requests to the appropriate DO based on:
 * 1. Subdomain: tenant.api.example.com -> DO('tenant')
 * 2. Header: X-Namespace -> DO(header value)
 * 3. Default: DO('default')
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Determine namespace from multiple sources
    let namespace = 'default'

    // 1. Check X-Namespace header
    const headerNamespace = request.headers.get('X-Namespace')
    if (headerNamespace) {
      namespace = headerNamespace
    }
    // 2. Check subdomain
    else {
      const hostParts = url.hostname.split('.')
      if (hostParts.length > 2) {
        namespace = hostParts[0]
      }
    }

    // Get DO instance
    const id = env.DO.idFromName(namespace)
    const stub = env.DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}
`

  await writeFile(join(targetDir, 'src', 'index.ts'), indexContent)
}

// ============================================================================
// Full Template - Complete app with auth, AI, events, and workflows
// ============================================================================
async function generateFullTemplate(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Generate DO class with all features
  const doClass = `import { DO, createContext } from 'dotdo/do'
import type { Hono, Context } from 'hono'
import { jwt } from 'hono/jwt'
import { cors } from 'hono/cors'

/**
 * MyDO - Full-featured Durable Object
 *
 * Features:
 * - RESTful CRUD operations with validation
 * - JWT authentication
 * - Event-driven workflows with $ context
 * - AI integration (when enabled)
 * - WebSocket support
 * - Audit logging
 */
export class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Setup event handlers using the $ context
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Example: Handle customer signup events
    this.$.on.Customer.signup(async (event) => {
      console.log('Customer signed up:', event)
      // Could trigger welcome email, create default resources, etc.
    })

    // Example: Handle item creation
    this.$.on.Item.created(async (event) => {
      console.log('Item created:', event)
    })

    // Example: Scheduled task - runs every hour
    // this.$.every.hour(async () => {
    //   console.log('Hourly task running...')
    // })
  }

  protected routes(app: Hono): void {
    // CORS for browser access
    app.use('/*', cors())

    // Public routes
    app.get('/health', (c) => {
      return c.json({
        status: 'healthy',
        id: this.state.id.toString(),
        timestamp: new Date().toISOString(),
        features: {
          auth: true,
          ai: ${config.features.ai},
          events: true,
          websocket: true,
        },
      })
    })

    // Protected API routes
    app.use('/api/*', async (c, next) => {
      const jwtMiddleware = jwt({
        secret: (c.env as Env).JWT_SECRET || 'development-secret',
      })
      return jwtMiddleware(c, next)
    })

    // ========================================================================
    // Items CRUD
    // ========================================================================

    app.get('/api/items', async (c) => {
      const type = c.req.query('type') || 'Item'
      const limit = parseInt(c.req.query('limit') || '100')
      const offset = parseInt(c.req.query('offset') || '0')

      // Set audit context from JWT
      const payload = c.get('jwtPayload')
      this.setAuditContext({
        userId: payload?.sub || 'anonymous',
        action: 'list',
      })

      const items = await this.things.list({ $type: type, limit, offset })
      return c.json({ data: items, meta: { type, limit, offset } })
    })

    app.get('/api/items/:id', async (c) => {
      const id = c.req.param('id')
      const item = await this.things.get(id)

      if (!item) {
        return c.json({ error: 'Not found' }, 404)
      }

      return c.json({ data: item })
    })

    app.post('/api/items', async (c) => {
      const body = await c.req.json()

      if (!body.$type) {
        return c.json({ error: 'Missing required field: $type' }, 400)
      }

      // Set audit context
      const payload = c.get('jwtPayload')
      this.setAuditContext({
        userId: payload?.sub || 'anonymous',
        action: 'create',
      })

      const item = await this.things.create(body)

      // Emit event for workflows
      await this.$.send({
        type: \`\${body.$type}.created\`,
        payload: { itemId: item.$id, ...body },
      })

      return c.json({ data: item }, 201)
    })

    app.put('/api/items/:id', async (c) => {
      const id = c.req.param('id')
      const body = await c.req.json()

      const existing = await this.things.get(id)
      if (!existing) {
        return c.json({ error: 'Not found' }, 404)
      }

      const payload = c.get('jwtPayload')
      this.setAuditContext({
        userId: payload?.sub || 'anonymous',
        action: 'update',
      })

      const updated = await this.things.update(id, body)

      await this.$.send({
        type: \`\${existing.$type}.updated\`,
        payload: { itemId: id, changes: body },
      })

      return c.json({ data: updated })
    })

    app.delete('/api/items/:id', async (c) => {
      const id = c.req.param('id')

      const existing = await this.things.get(id)
      if (!existing) {
        return c.json({ error: 'Not found' }, 404)
      }

      const payload = c.get('jwtPayload')
      this.setAuditContext({
        userId: payload?.sub || 'anonymous',
        action: 'delete',
      })

      await this.things.delete(id)

      await this.$.send({
        type: \`\${existing.$type}.deleted\`,
        payload: { itemId: id },
      })

      return c.json({ success: true })
    })

    // ========================================================================
    // Events & Audit
    // ========================================================================

    app.get('/api/events', async (c) => {
      const type = c.req.query('type')
      const limit = parseInt(c.req.query('limit') || '100')
      const events = await this.events.list({ type, limit })
      return c.json({ data: events })
    })

    app.get('/api/audit', async (c) => {
      const limit = parseInt(c.req.query('limit') || '100')
      const logs = await this.auditLogs.list({ limit })
      return c.json({ data: logs })
    })

    // ========================================================================
    // Relationships
    // ========================================================================

    app.post('/api/relationships', async (c) => {
      const body = await c.req.json()

      if (!body.fromId || !body.toId || !body.type) {
        return c.json({
          error: 'Missing required fields: fromId, toId, type',
        }, 400)
      }

      const rel = await this.relationships.create(body)
      return c.json({ data: rel }, 201)
    })

    app.get('/api/relationships/:id', async (c) => {
      const id = c.req.param('id')
      const direction = c.req.query('direction') as 'from' | 'to' | 'both' || 'both'

      const rels = await this.relationships.findByEntity(id, { direction })
      return c.json({ data: rels })
    })

${config.features.ai ? `
    // ========================================================================
    // AI Endpoints
    // ========================================================================

    app.post('/api/ai/complete', async (c) => {
      const { prompt, model } = await c.req.json()

      if (!prompt) {
        return c.json({ error: 'Missing required field: prompt' }, 400)
      }

      // Use Workers AI
      const ai = (c.env as Env).AI
      if (!ai) {
        return c.json({ error: 'AI not configured' }, 503)
      }

      const result = await ai.run(model || '@cf/meta/llama-2-7b-chat-int8', {
        prompt,
      })

      return c.json({ data: result })
    })
` : ''}
    // ========================================================================
    // WebSocket Endpoint
    // ========================================================================

    app.get('/ws', async (c) => {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Expected WebSocket' }, 426)
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      // Accept and track the WebSocket
      this.ws.add(server, { id: crypto.randomUUID() })

      return new Response(null, {
        status: 101,
        webSocket: client,
      })
    })
  }
}
`

  await writeFile(join(targetDir, 'src', 'do.ts'), doClass)

  // Generate worker entry point
  const indexContent = `/// <reference path="./env.d.ts" />
import { MyDO } from './do'

// Export the Durable Object class for wrangler
export { MyDO }

/**
 * Worker entry point for full-featured template
 *
 * Features:
 * - Multi-tenant routing via subdomain or header
 * - Request logging
 * - Error handling
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const startTime = Date.now()

    try {
      // Determine namespace
      let namespace = 'default'

      // Priority: Header > Subdomain > Default
      const headerNamespace = request.headers.get('X-Namespace')
      if (headerNamespace) {
        namespace = headerNamespace
      } else {
        const hostParts = url.hostname.split('.')
        if (hostParts.length > 2) {
          namespace = hostParts[0]
        }
      }

      // Get DO instance
      const id = env.DO.idFromName(namespace)
      const stub = env.DO.get(id)

      // Forward request
      const response = await stub.fetch(request)

      // Add timing header
      const duration = Date.now() - startTime
      const newResponse = new Response(response.body, response)
      newResponse.headers.set('X-Response-Time', \`\${duration}ms\`)
      newResponse.headers.set('X-Namespace', namespace)

      return newResponse
    } catch (error) {
      console.error('Worker error:', error)

      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  },
}
`

  await writeFile(join(targetDir, 'src', 'index.ts'), indexContent)
}

async function generateTestFiles(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  // Generate tests based on template
  if (config.template === 'basic') {
    await generateBasicTests(targetDir, config)
  } else if (config.template === 'api') {
    await generateApiTests(targetDir, config)
  } else {
    await generateFullTests(targetDir, config)
  }

  // Generate vitest config
  const vitestConfig = `import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
`

  await writeFile(join(targetDir, 'vitest.config.ts'), vitestConfig)
}

async function generateBasicTests(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const testContent = `import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

describe('MyDO', () => {
  it('should respond to health check', async () => {
    const id = env.DO.idFromName('test')
    const stub = env.DO.get(id)
    const res = await stub.fetch('http://test/')

    expect(res.status).toBe(200)
    const data = await res.json<{ status: string }>()
    expect(data.status).toBe('ok')
  })

  it('should respond to custom route', async () => {
    const id = env.DO.idFromName('test')
    const stub = env.DO.get(id)
    const res = await stub.fetch('http://test/hello')

    expect(res.status).toBe(200)
    const data = await res.json<{ message: string }>()
    expect(data.message).toBe('Hello from MyDO!')
  })

  it('should create and retrieve things', async () => {
    const id = env.DO.idFromName('test-things')
    const stub = env.DO.get(id)

    // Create
    const createRes = await stub.fetch('http://test/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Thing', value: 42 }),
    })

    expect(createRes.status).toBe(200)
    const created = await createRes.json<{ data: { $id: string } }>()
    expect(created.data.$id).toBeDefined()

    // Retrieve list
    const listRes = await stub.fetch('http://test/things')
    expect(listRes.status).toBe(200)
    const list = await listRes.json<{ data: Array<{ name: string }> }>()
    expect(list.data.length).toBeGreaterThan(0)

    // Retrieve by ID
    const getRes = await stub.fetch(\`http://test/things/\${created.data.$id}\`)
    expect(getRes.status).toBe(200)
    const item = await getRes.json<{ data: { name: string; value: number } }>()
    expect(item.data.name).toBe('Test Thing')
    expect(item.data.value).toBe(42)
  })
})
`

  await writeFile(join(targetDir, 'tests', 'do.test.ts'), testContent)
}

async function generateApiTests(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const testContent = `import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

describe('MyDO API', () => {
  const getStub = (name: string) => {
    const id = env.DO.idFromName(name)
    return env.DO.get(id)
  }

  describe('Health', () => {
    it('should return health status', async () => {
      const stub = getStub('health-test')
      const res = await stub.fetch('http://test/health')

      expect(res.status).toBe(200)
      const data = await res.json<{ status: string }>()
      expect(data.status).toBe('healthy')
    })
  })

  describe('Items CRUD', () => {
    const apiHeaders = {
      'Content-Type': 'application/json',
${config.features.auth ? `      // In real tests, generate a valid JWT
      'Authorization': 'Bearer test-token',` : ''}
    }

    it('should create an item', async () => {
      const stub = getStub('crud-test')
      const res = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          $type: 'Task',
          title: 'Test Task',
          completed: false,
        }),
      })

      expect(res.status).toBe(201)
      const data = await res.json<{ data: { $id: string; $type: string } }>()
      expect(data.data.$id).toBeDefined()
      expect(data.data.$type).toBe('Task')
    })

    it('should require $type for creation', async () => {
      const stub = getStub('crud-test')
      const res = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ title: 'Missing type' }),
      })

      expect(res.status).toBe(400)
    })

    it('should list items by type', async () => {
      const stub = getStub('list-test')

      // Create some items
      await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ $type: 'Product', name: 'Product 1' }),
      })
      await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ $type: 'Product', name: 'Product 2' }),
      })

      // List
      const res = await stub.fetch('http://test/api/items?type=Product', {
        headers: apiHeaders,
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ data: Array<{ name: string }> }>()
      expect(data.data.length).toBe(2)
    })

    it('should update an item', async () => {
      const stub = getStub('update-test')

      // Create
      const createRes = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ $type: 'Note', content: 'Original' }),
      })
      const created = await createRes.json<{ data: { $id: string } }>()

      // Update
      const updateRes = await stub.fetch(\`http://test/api/items/\${created.data.$id}\`, {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({ content: 'Updated' }),
      })

      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json<{ data: { content: string } }>()
      expect(updated.data.content).toBe('Updated')
    })

    it('should delete an item', async () => {
      const stub = getStub('delete-test')

      // Create
      const createRes = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({ $type: 'Temp', name: 'To Delete' }),
      })
      const created = await createRes.json<{ data: { $id: string } }>()

      // Delete
      const deleteRes = await stub.fetch(\`http://test/api/items/\${created.data.$id}\`, {
        method: 'DELETE',
        headers: apiHeaders,
      })

      expect(deleteRes.status).toBe(200)

      // Verify deleted
      const getRes = await stub.fetch(\`http://test/api/items/\${created.data.$id}\`, {
        headers: apiHeaders,
      })
      expect(getRes.status).toBe(404)
    })
  })

  describe('Events', () => {
    it('should list events', async () => {
      const stub = getStub('events-test')

      const res = await stub.fetch('http://test/api/events', {
        headers: {
${config.features.auth ? `          'Authorization': 'Bearer test-token',` : ''}
        },
      })

      expect(res.status).toBe(200)
      const data = await res.json<{ data: unknown[] }>()
      expect(Array.isArray(data.data)).toBe(true)
    })
  })
})
`

  await writeFile(join(targetDir, 'tests', 'do.test.ts'), testContent)
}

async function generateFullTests(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const testContent = `import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

describe('MyDO Full', () => {
  const getStub = (name: string) => {
    const id = env.DO.idFromName(name)
    return env.DO.get(id)
  }

  // Helper to create auth headers (in real app, use proper JWT)
  const authHeaders = (additionalHeaders: Record<string, string> = {}) => ({
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token',
    ...additionalHeaders,
  })

  describe('Health & Info', () => {
    it('should return health with features', async () => {
      const stub = getStub('health-test')
      const res = await stub.fetch('http://test/health')

      expect(res.status).toBe(200)
      const data = await res.json<{
        status: string
        features: { auth: boolean; events: boolean }
      }>()
      expect(data.status).toBe('healthy')
      expect(data.features.auth).toBe(true)
      expect(data.features.events).toBe(true)
    })
  })

  describe('Items CRUD', () => {
    it('should create item and trigger event', async () => {
      const stub = getStub('crud-events-test')

      // Create item
      const res = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          $type: 'Order',
          customerId: 'cust-123',
          total: 99.99,
        }),
      })

      expect(res.status).toBe(201)

      // Check that event was created
      const eventsRes = await stub.fetch('http://test/api/events?type=Order.created', {
        headers: authHeaders(),
      })
      const events = await eventsRes.json<{ data: Array<{ type: string }> }>()
      expect(events.data.some(e => e.type === 'Order.created')).toBe(true)
    })
  })

  describe('Relationships', () => {
    it('should create and query relationships', async () => {
      const stub = getStub('relationships-test')

      // Create two items
      const item1Res = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ $type: 'User', name: 'Alice' }),
      })
      const item1 = await item1Res.json<{ data: { $id: string } }>()

      const item2Res = await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ $type: 'Project', name: 'Alpha' }),
      })
      const item2 = await item2Res.json<{ data: { $id: string } }>()

      // Create relationship
      const relRes = await stub.fetch('http://test/api/relationships', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fromId: item1.data.$id,
          toId: item2.data.$id,
          type: 'owns',
        }),
      })

      expect(relRes.status).toBe(201)

      // Query relationships
      const queryRes = await stub.fetch(\`http://test/api/relationships/\${item1.data.$id}\`, {
        headers: authHeaders(),
      })

      expect(queryRes.status).toBe(200)
      const rels = await queryRes.json<{ data: Array<{ type: string }> }>()
      expect(rels.data.some(r => r.type === 'owns')).toBe(true)
    })
  })

  describe('Audit', () => {
    it('should log audit entries', async () => {
      const stub = getStub('audit-test')

      // Perform an action
      await stub.fetch('http://test/api/items', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ $type: 'Document', title: 'Test' }),
      })

      // Check audit log
      const auditRes = await stub.fetch('http://test/api/audit', {
        headers: authHeaders(),
      })

      expect(auditRes.status).toBe(200)
      const logs = await auditRes.json<{ data: unknown[] }>()
      expect(logs.data.length).toBeGreaterThan(0)
    })
  })

${config.features.ai ? `
  describe('AI', () => {
    it('should require prompt for completion', async () => {
      const stub = getStub('ai-test')

      const res = await stub.fetch('http://test/api/ai/complete', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)
    })

    // Note: Full AI tests require Workers AI binding in test environment
  })
` : ''}
  describe('WebSocket', () => {
    it('should require upgrade header for /ws', async () => {
      const stub = getStub('ws-test')

      const res = await stub.fetch('http://test/ws')
      expect(res.status).toBe(426) // Upgrade Required
    })
  })
})
`

  await writeFile(join(targetDir, 'tests', 'do.test.ts'), testContent)
}

async function generateReadme(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const readme = `# ${config.name}

A dotdo project - Business-as-Code, Services-as-Software

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Deploy
npm run deploy
\`\`\`

## Project Structure

\`\`\`
src/
  index.ts    # Worker entry point
  do.ts       # Durable Object class
tests/
  do.test.ts  # Tests
\`\`\`

## Documentation

- [dotdo Documentation](https://dotdo.dev)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)

## Template

This project was created with: \`dotdo init --template=${config.template}\`

Features:
${config.features.db ? '- Database support' : ''}
${config.features.auth ? '- Authentication' : ''}
${config.features.ai ? '- AI module' : ''}
${config.features.mcp ? '- MCP server' : ''}
`

  await writeFile(join(targetDir, 'README.md'), readme)
}

async function initGit(targetDir: string): Promise<void> {
  try {
    // Check if git is available
    execSync('git --version', { stdio: 'ignore' })

    // Check if already a git repo
    try {
      execSync('git rev-parse --git-dir', { cwd: targetDir, stdio: 'ignore' })
      console.log('Git repository already exists, skipping git init')
      return
    } catch {
      // Not a git repo, proceed
    }

    execSync('git init', { cwd: targetDir, stdio: 'ignore' })
    execSync('git add .', { cwd: targetDir, stdio: 'ignore' })
    execSync('git commit -m "Initial commit from dotdo init"', {
      cwd: targetDir,
      stdio: 'ignore',
    })
    console.log('✓ Initialized git repository')
  } catch (error) {
    console.log('Git initialization skipped (git not available)')
  }
}

async function installDependencies(targetDir: string): Promise<void> {
  console.log('\nInstalling dependencies...')
  try {
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' })
    console.log('✓ Dependencies installed')
  } catch (error) {
    console.error('Failed to install dependencies. Run `npm install` manually.')
  }
}
