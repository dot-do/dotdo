/**
 * DevWorkspaceDO - Complete Development Workspace
 *
 * Demonstrates all extended primitives (fsx + gitx + bashx) working together
 * in a realistic development workspace scenario.
 *
 * This DO simulates what an AI agent would use to:
 * - Create and manage project files
 * - Version control changes with git
 * - Run build scripts and tests
 * - Execute a full development workflow
 *
 * Primitives Used:
 * - $.fs: Create files, directories, read/write operations
 * - $.git: Initialize repo, commit changes, sync with remote
 * - $.bash: Run npm commands, build scripts, custom commands
 * - $.npm: Package management (via bash integration)
 *
 * @example
 * ```typescript
 * const workspace = env.WORKSPACE_DO.get(id)
 *
 * // Create a new project from scratch
 * await workspace.createProject('my-api', {
 *   template: 'typescript-api',
 *   features: ['auth', 'database']
 * })
 *
 * // Add a new feature
 * await workspace.addFeature('dark-mode', {
 *   files: [...],
 *   tests: true
 * })
 *
 * // Build and test
 * const result = await workspace.buildAndTest()
 * ```
 */

import { DOWithPrimitives } from 'dotdo/presets'
import type { PrimitivesContext } from 'dotdo/presets'

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectConfig {
  name: string
  description?: string
  template?: 'typescript-api' | 'typescript-cli' | 'react-app' | 'minimal'
  features?: string[]
  gitRemote?: string
}

export interface FileSpec {
  path: string
  content: string
}

export interface AddFeatureOptions {
  files: FileSpec[]
  tests?: boolean
  commit?: boolean
  commitMessage?: string
}

export interface BuildTestResult {
  success: boolean
  buildOutput: string
  testOutput?: string
  testsPassed?: number
  testsFailed?: number
  duration: number
  artifacts?: string[]
  errors?: string[]
}

export interface WorkspaceStatus {
  initialized: boolean
  projectName?: string
  git: {
    branch: string
    head?: string
    staged: string[]
    unstaged: string[]
    clean: boolean
  }
  files: {
    count: number
    totalSize: number
  }
  lastBuild?: {
    success: boolean
    timestamp: Date
    duration: number
  }
}

export interface DevCycleResult {
  success: boolean
  steps: Array<{
    name: string
    success: boolean
    output: string
    duration: number
  }>
  totalDuration: number
  commit?: string
}

// ============================================================================
// TEMPLATES
// ============================================================================

const TEMPLATES = {
  'typescript-api': {
    files: [
      {
        path: '/package.json',
        content: (name: string, desc: string) => JSON.stringify({
          name,
          version: '0.0.1',
          description: desc,
          type: 'module',
          scripts: {
            dev: 'wrangler dev',
            build: 'tsc',
            test: 'vitest run',
            lint: 'eslint src/',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {
            hono: '^4.6.0',
          },
          devDependencies: {
            '@cloudflare/workers-types': '^4.20241230.0',
            typescript: '^5.7.0',
            vitest: '^2.1.0',
            wrangler: '^4.58.0',
          },
        }, null, 2),
      },
      {
        path: '/tsconfig.json',
        content: () => JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022'],
            types: ['@cloudflare/workers-types'],
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ['src/**/*.ts'],
          exclude: ['node_modules'],
        }, null, 2),
      },
      {
        path: '/src/index.ts',
        content: (name: string) => `/**
 * ${name} - API Entry Point
 */

import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({ message: 'Hello from ${name}!' })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app
`,
      },
      {
        path: '/src/index.test.ts',
        content: (name: string) => `import { describe, it, expect } from 'vitest'

describe('${name}', () => {
  it('should return hello message', () => {
    const message = 'Hello from ${name}!'
    expect(message).toContain('Hello')
  })

  it('should have valid structure', () => {
    expect(true).toBe(true)
  })
})
`,
      },
    ],
  },
  'minimal': {
    files: [
      {
        path: '/package.json',
        content: (name: string, desc: string) => JSON.stringify({
          name,
          version: '0.0.1',
          description: desc,
          type: 'module',
          scripts: {
            build: 'echo "Build complete"',
            test: 'echo "Tests passed"',
          },
        }, null, 2),
      },
      {
        path: '/src/index.ts',
        content: (name: string) => `// ${name}\nexport const hello = () => 'Hello, World!'\n`,
      },
    ],
  },
} as const

// ============================================================================
// ENVIRONMENT
// ============================================================================

interface Env {
  R2_BUCKET?: R2Bucket
  GITHUB_TOKEN?: string
}

// ============================================================================
// DEVWORKSPACE DURABLE OBJECT
// ============================================================================

/**
 * DevWorkspaceDO - A development workspace combining all primitives
 *
 * This DO demonstrates the full power of dotdo's extended primitives:
 * - Create projects from templates using $.fs
 * - Version control with $.git
 * - Run builds and tests with $.bash
 *
 * It simulates what an AI coding agent would use to write, test,
 * and deploy code - all within a single V8 isolate.
 */
export class DevWorkspaceDO extends DOWithPrimitives<Env> {
  static readonly $type = 'DevWorkspaceDO'

  // Track project state
  private projectName: string | null = null
  private lastBuildResult: BuildTestResult | null = null

  // Get typed primitives context
  private get primitives(): PrimitivesContext {
    return this.getPrimitivesContext()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new project from a template.
   *
   * Demonstrates:
   * - $.fs.mkdir() for directory creation
   * - $.fs.write() for file creation
   * - $.git.init() for repository initialization
   * - $.git.add() and $.git.commit() for initial commit
   *
   * @example
   * ```typescript
   * await workspace.createProject({
   *   name: 'my-api',
   *   description: 'My awesome API',
   *   template: 'typescript-api'
   * })
   * ```
   */
  async createProject(config: ProjectConfig): Promise<{
    success: boolean
    filesCreated: string[]
    message: string
  }> {
    const { name, description = '', template = 'minimal' } = config
    const $ = this.primitives
    const filesCreated: string[] = []

    try {
      // 1. Create project directories
      await $.fs.mkdir('/src', { recursive: true })
      await $.fs.mkdir('/dist', { recursive: true })

      // 2. Get template files
      const templateConfig = TEMPLATES[template] ?? TEMPLATES.minimal
      const files = templateConfig.files

      // 3. Write all template files
      for (const file of files) {
        const content = typeof file.content === 'function'
          ? file.content(name, description)
          : file.content

        // Ensure parent directory exists
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await $.fs.mkdir(parentDir, { recursive: true })
        }

        await $.fs.write(file.path, content)
        filesCreated.push(file.path)
      }

      // 4. Add README
      const readme = `# ${name}\n\n${description || 'A dotdo project.'}\n\n## Development\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`
      await $.fs.write('/README.md', readme)
      filesCreated.push('/README.md')

      // 5. Initialize git repository
      await $.git.init()

      // 6. Configure git if remote provided
      if (config.gitRemote && this.env.R2_BUCKET) {
        $.git.configure({
          repo: config.gitRemote,
          branch: 'main',
          r2: this.env.R2_BUCKET as unknown as import('../../../lib/mixins/git').R2BucketLike,
          fs: $.fs,
        })
      }

      // 7. Stage and commit all files
      await $.git.add('.')
      await $.git.commit(`feat: initial project setup for ${name}`)

      // Store project name
      this.projectName = name

      return {
        success: true,
        filesCreated,
        message: `Project "${name}" created with ${filesCreated.length} files`,
      }
    } catch (error) {
      return {
        success: false,
        filesCreated,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add multiple files to the workspace.
   *
   * Demonstrates:
   * - Batch $.fs.write() operations
   * - $.git.add() for staging
   * - Optional auto-commit with $.git.commit()
   */
  async addFiles(
    files: FileSpec[],
    options?: { commit?: boolean; commitMessage?: string }
  ): Promise<{ success: boolean; added: string[]; error?: string }> {
    const $ = this.primitives
    const added: string[] = []

    try {
      for (const file of files) {
        // Ensure parent directory exists
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await $.fs.mkdir(parentDir, { recursive: true })
        }

        await $.fs.write(file.path, file.content)
        added.push(file.path)
      }

      // Stage files
      await $.git.add(added)

      // Optionally commit
      if (options?.commit) {
        const message = options.commitMessage ?? `feat: add ${added.length} file(s)`
        await $.git.commit(message)
      }

      return { success: true, added }
    } catch (error) {
      return {
        success: false,
        added,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Read a file from the workspace.
   */
  async readFile(path: string): Promise<{ content: string } | { error: string }> {
    try {
      const content = await this.primitives.fs.read(path)
      return { content }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * List files in a directory.
   */
  async listFiles(path: string = '/'): Promise<string[]> {
    try {
      const entries = await this.primitives.fs.list(path)
      return entries.map(e => e.name)
    } catch {
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FEATURE DEVELOPMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a new feature to the project.
   *
   * Demonstrates a complete feature development workflow:
   * 1. Create feature files with $.fs
   * 2. Generate test files if requested
   * 3. Stage changes with $.git
   * 4. Commit with conventional message
   *
   * @example
   * ```typescript
   * await workspace.addFeature('dark-mode', {
   *   files: [
   *     { path: '/src/theme.ts', content: 'export const darkTheme = {...}' }
   *   ],
   *   tests: true,
   *   commit: true
   * })
   * ```
   */
  async addFeature(
    featureName: string,
    options: AddFeatureOptions
  ): Promise<{ success: boolean; filesCreated: string[]; commit?: string }> {
    const $ = this.primitives
    const filesCreated: string[] = []

    try {
      // 1. Create feature files
      for (const file of options.files) {
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await $.fs.mkdir(parentDir, { recursive: true })
        }

        await $.fs.write(file.path, file.content)
        filesCreated.push(file.path)
      }

      // 2. Generate test files if requested
      if (options.tests) {
        for (const file of options.files) {
          if (file.path.endsWith('.ts') && !file.path.includes('.test.')) {
            const testPath = file.path.replace('.ts', '.test.ts')
            const testContent = this.generateTestFile(file.path, featureName)
            await $.fs.write(testPath, testContent)
            filesCreated.push(testPath)
          }
        }
      }

      // 3. Stage all new files
      await $.git.add(filesCreated)

      // 4. Commit if requested
      let commitHash: string | undefined
      if (options.commit !== false) {
        const message = options.commitMessage ?? `feat: add ${featureName}`
        const result = await $.git.commit(message)
        commitHash = result.hash
      }

      return {
        success: true,
        filesCreated,
        commit: commitHash,
      }
    } catch (error) {
      return {
        success: false,
        filesCreated,
      }
    }
  }

  /**
   * Generate a basic test file for a source file.
   */
  private generateTestFile(sourcePath: string, featureName: string): string {
    const fileName = sourcePath.split('/').pop()?.replace('.ts', '') ?? 'module'

    return `import { describe, it, expect } from 'vitest'

describe('${featureName}', () => {
  it('should be defined', () => {
    // TODO: Add tests for ${fileName}
    expect(true).toBe(true)
  })

  it('should work correctly', () => {
    // TODO: Add more specific tests
    expect(true).toBe(true)
  })
})
`
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD & TEST
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run the build process.
   *
   * Demonstrates:
   * - $.bash.exec() for running npm commands
   * - Error handling for build failures
   * - Capturing build output and artifacts
   */
  async build(): Promise<BuildTestResult> {
    const $ = this.primitives
    const startTime = Date.now()
    const errors: string[] = []

    try {
      // Run build command
      const result = await $.bash.exec('npm', ['run', 'build'])

      const duration = Date.now() - startTime

      // List build artifacts
      let artifacts: string[] = []
      try {
        const distFiles = await $.fs.list('/dist')
        artifacts = distFiles.map(f => `/dist/${f.name}`)
      } catch {
        // No dist directory yet
      }

      const buildResult: BuildTestResult = {
        success: result.exitCode === 0,
        buildOutput: result.stdout + result.stderr,
        duration,
        artifacts,
        errors: result.exitCode !== 0 ? [result.stderr] : undefined,
      }

      this.lastBuildResult = buildResult
      return buildResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(message)

      return {
        success: false,
        buildOutput: '',
        duration: Date.now() - startTime,
        errors,
      }
    }
  }

  /**
   * Run tests.
   *
   * Demonstrates:
   * - $.bash.exec() with npm test
   * - Parsing test output for results
   */
  async test(): Promise<BuildTestResult> {
    const $ = this.primitives
    const startTime = Date.now()

    try {
      const result = await $.bash.exec('npm', ['test'])
      const duration = Date.now() - startTime

      // Parse test output for pass/fail counts
      const { passed, failed } = this.parseTestOutput(result.stdout)

      return {
        success: result.exitCode === 0,
        buildOutput: '',
        testOutput: result.stdout + result.stderr,
        testsPassed: passed,
        testsFailed: failed,
        duration,
        errors: result.exitCode !== 0 ? [result.stderr] : undefined,
      }
    } catch (error) {
      return {
        success: false,
        buildOutput: '',
        testOutput: '',
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }
  }

  /**
   * Run both build and test.
   */
  async buildAndTest(): Promise<BuildTestResult> {
    const $ = this.primitives
    const startTime = Date.now()
    const errors: string[] = []

    // Build first
    const buildResult = await this.build()
    if (!buildResult.success) {
      return {
        ...buildResult,
        duration: Date.now() - startTime,
      }
    }

    // Then test
    const testResult = await this.test()

    return {
      success: testResult.success,
      buildOutput: buildResult.buildOutput,
      testOutput: testResult.testOutput,
      testsPassed: testResult.testsPassed,
      testsFailed: testResult.testsFailed,
      duration: Date.now() - startTime,
      artifacts: buildResult.artifacts,
      errors: [...(buildResult.errors ?? []), ...(testResult.errors ?? [])],
    }
  }

  /**
   * Parse test output to extract pass/fail counts.
   */
  private parseTestOutput(output: string): { passed: number; failed: number } {
    // Try to match common test output formats
    // Vitest: "Test Files  1 passed (1)"
    // Jest: "Tests:       1 passed, 1 total"
    // Generic: "X tests passed" or "passed: X"

    let passed = 0
    let failed = 0

    // Vitest format
    const vitestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i)
    if (vitestMatch) {
      passed = parseInt(vitestMatch[1], 10)
      failed = parseInt(vitestMatch[2], 10)
    } else {
      // Generic format
      const passMatch = output.match(/(\d+)\s+(?:tests?\s+)?passed/i)
      const failMatch = output.match(/(\d+)\s+(?:tests?\s+)?failed/i)
      if (passMatch) passed = parseInt(passMatch[1], 10)
      if (failMatch) failed = parseInt(failMatch[1], 10)
    }

    return { passed, failed }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL DEVELOPMENT CYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a complete development cycle.
   *
   * This is the hero example showing all primitives working together:
   * 1. Create/update files ($.fs)
   * 2. Build the project ($.bash)
   * 3. Run tests ($.bash)
   * 4. Commit changes ($.git)
   * 5. Push to remote ($.git)
   *
   * @example
   * ```typescript
   * const result = await workspace.runDevCycle({
   *   files: [
   *     { path: '/src/feature.ts', content: '...' }
   *   ],
   *   commitMessage: 'feat: add new feature',
   *   push: true
   * })
   * ```
   */
  async runDevCycle(options: {
    files: FileSpec[]
    commitMessage: string
    push?: boolean
    skipTests?: boolean
  }): Promise<DevCycleResult> {
    const $ = this.primitives
    const startTime = Date.now()
    const steps: DevCycleResult['steps'] = []

    try {
      // Step 1: Write files
      const writeStart = Date.now()
      for (const file of options.files) {
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await $.fs.mkdir(parentDir, { recursive: true })
        }
        await $.fs.write(file.path, file.content)
      }
      steps.push({
        name: 'write-files',
        success: true,
        output: `Wrote ${options.files.length} file(s)`,
        duration: Date.now() - writeStart,
      })

      // Step 2: Build
      const buildStart = Date.now()
      const buildResult = await $.bash.exec('npm', ['run', 'build'])
      steps.push({
        name: 'build',
        success: buildResult.exitCode === 0,
        output: buildResult.stdout,
        duration: Date.now() - buildStart,
      })
      if (buildResult.exitCode !== 0) {
        throw new Error(`Build failed: ${buildResult.stderr}`)
      }

      // Step 3: Test (unless skipped)
      if (!options.skipTests) {
        const testStart = Date.now()
        const testResult = await $.bash.exec('npm', ['test'])
        steps.push({
          name: 'test',
          success: testResult.exitCode === 0,
          output: testResult.stdout,
          duration: Date.now() - testStart,
        })
        if (testResult.exitCode !== 0) {
          throw new Error(`Tests failed: ${testResult.stderr}`)
        }
      }

      // Step 4: Stage and commit
      const commitStart = Date.now()
      await $.git.add('.')
      const commitResult = await $.git.commit(options.commitMessage)
      steps.push({
        name: 'commit',
        success: true,
        output: `Committed: ${commitResult.hash}`,
        duration: Date.now() - commitStart,
      })

      // Step 5: Push (if requested)
      let pushOutput = 'Push skipped'
      if (options.push) {
        const pushStart = Date.now()
        const pushResult = await $.git.push()
        pushOutput = pushResult.success
          ? `Pushed ${pushResult.objectsPushed} objects`
          : `Push failed: ${pushResult.error}`
        steps.push({
          name: 'push',
          success: pushResult.success,
          output: pushOutput,
          duration: Date.now() - pushStart,
        })
        if (!pushResult.success) {
          throw new Error(pushOutput)
        }
      }

      return {
        success: true,
        steps,
        totalDuration: Date.now() - startTime,
        commit: commitResult.hash,
      }
    } catch (error) {
      return {
        success: false,
        steps,
        totalDuration: Date.now() - startTime,
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS & INSPECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current workspace status.
   *
   * Combines information from all primitives:
   * - File system stats ($.fs)
   * - Git status ($.git)
   * - Last build result
   */
  async getStatus(): Promise<WorkspaceStatus> {
    const $ = this.primitives

    // Get git status
    const gitStatus = await $.git.status()

    // Count files and total size
    let fileCount = 0
    let totalSize = 0

    const countFiles = async (dir: string): Promise<void> => {
      try {
        const entries = await $.fs.list(dir)
        for (const entry of entries) {
          const fullPath = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`
          if (entry.isDirectory) {
            await countFiles(fullPath)
          } else {
            fileCount++
            try {
              const stats = await $.fs.stat(fullPath)
              totalSize += stats.size
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    await countFiles('/')

    return {
      initialized: this.projectName !== null,
      projectName: this.projectName ?? undefined,
      git: {
        branch: gitStatus.branch,
        head: gitStatus.head,
        staged: gitStatus.staged ?? [],
        unstaged: gitStatus.unstaged ?? [],
        clean: gitStatus.clean,
      },
      files: {
        count: fileCount,
        totalSize,
      },
      lastBuild: this.lastBuildResult ? {
        success: this.lastBuildResult.success,
        timestamp: new Date(),
        duration: this.lastBuildResult.duration,
      } : undefined,
    }
  }

  /**
   * Get git commit history.
   */
  async getHistory(limit: number = 10): Promise<Array<{
    hash: string
    message: string
    author?: string
    date?: Date
  }>> {
    const commits = await this.primitives.git.log({ limit })
    return commits.map(c => ({
      hash: c.hash,
      message: c.message,
      author: c.author,
      date: c.date,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHELL EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a custom shell command.
   *
   * Demonstrates $.bash.exec() for arbitrary command execution.
   * Commands are analyzed for safety before execution.
   */
  async exec(command: string, args: string[] = []): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }> {
    const result = await this.primitives.bash.exec(command, args)
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }
  }

  /**
   * Run npm commands safely.
   */
  async npm(subcommand: string, args: string[] = []): Promise<{
    success: boolean
    output: string
  }> {
    const result = await this.primitives.bash.exec('npm', [subcommand, ...args])
    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    }
  }
}
