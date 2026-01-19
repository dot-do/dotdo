// dotdo init - Interactive project scaffolding
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
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
    '@cloudflare/workers-types': '^4.0.0',
    '@cloudflare/vitest-pool-workers': '^0.8.0',
    typescript: '^5.7.0',
    vitest: '^2.1.0',
    wrangler: '^3.101.0',
  }

  if (config.features.auth) {
    dependencies['dotdo'] = '^0.0.1' // already included
  }

  const pkg = {
    name: config.name,
    version: '0.0.1',
    type: 'module',
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      test: 'vitest',
      'test:run': 'vitest run',
      typecheck: 'tsc --noEmit',
    },
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
  const wranglerConfig = {
    name: config.name,
    main: 'src/index.ts',
    compatibility_date: '2025-01-15',
    durable_objects: {
      bindings: [{ name: 'DO', class_name: 'MyDO' }],
    },
  }

  await writeFile(
    join(targetDir, 'wrangler.jsonc'),
    JSON.stringify(wranglerConfig, null, 2) + '\n'
  )
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
  // Generate DO class
  const doClass = `import { DO } from 'dotdo/do'

export class MyDO extends DO {
  constructor(state: DurableObjectState, env: any) {
    super(state, env)

    // Setup routes
    this.routes(this.app)
  }

  protected routes(app: any) {
    // Add your custom routes here
    app.get('/hello', (c: any) => {
      return c.json({ message: 'Hello from MyDO!' })
    })

    // Example: Create a thing
    app.post('/things', async (c: any) => {
      const body = await c.req.json()
      await this.state.storage.put('thing', body)
      return c.json({ success: true, data: body })
    })

    // Example: Get a thing
    app.get('/things', async (c: any) => {
      const thing = await this.state.storage.get('thing')
      return c.json({ data: thing || null })
    })
  }
}
`

  await writeFile(join(targetDir, 'src', 'do.ts'), doClass)

  // Generate worker entry point
  const indexContent = `import { MyDO } from './do'

export { MyDO }

export interface Env {
  DO: DurableObjectNamespace<MyDO>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Extract namespace from subdomain (optional)
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const namespace = hostParts.length > 2 ? hostParts[0] : 'default'

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

async function generateTestFiles(
  targetDir: string,
  config: ProjectConfig
): Promise<void> {
  const testContent = `import { describe, it, expect } from 'vitest'
import { env, SELF } from 'cloudflare:test'

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

    // Retrieve
    const getRes = await stub.fetch('http://test/things')
    expect(getRes.status).toBe(200)

    const data = await getRes.json<{ data: { name: string; value: number } }>()
    expect(data.data.name).toBe('Test Thing')
    expect(data.data.value).toBe(42)
  })
})
`

  await writeFile(join(targetDir, 'tests', 'do.test.ts'), testContent)

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
