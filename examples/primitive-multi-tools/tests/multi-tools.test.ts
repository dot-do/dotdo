/**
 * Multi-Tools Integration Tests
 *
 * Tests for the primitive-multi-tools example demonstrating
 * fsx + gitx + bashx working together.
 *
 * Test categories:
 * 1. Project Creation - Creating projects with templates
 * 2. File Operations - Adding, reading, listing files
 * 3. Feature Development - Adding features with tests
 * 4. Build & Test - Running npm commands
 * 5. Dev Cycle - Full development workflow
 * 6. Status & Inspection - Getting workspace state
 *
 * These tests use mocks to simulate the primitives behavior
 * without requiring actual DO infrastructure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock Primitives
// ============================================================================

/**
 * Create mock filesystem capability.
 * Simulates fsx behavior with in-memory storage.
 */
function createMockFs() {
  const files = new Map<string, { content: string; size: number; mtime: Date }>()
  const dirs = new Set<string>(['/'])

  return {
    mkdir: vi.fn().mockImplementation(async (path: string, options?: { recursive?: boolean }) => {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          dirs.add(current)
        }
      } else {
        dirs.add(path)
      }
    }),

    write: vi.fn().mockImplementation(async (path: string, content: string) => {
      files.set(path, {
        content,
        size: content.length,
        mtime: new Date(),
      })
    }),

    read: vi.fn().mockImplementation(async (path: string) => {
      const file = files.get(path)
      if (!file) throw new Error(`File not found: ${path}`)
      return file.content
    }),

    list: vi.fn().mockImplementation(async (path: string) => {
      const entries: Array<{ name: string; isDirectory: boolean }> = []
      const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
      const prefix = normalizedPath === '' ? '/' : normalizedPath + '/'

      // Find files in this directory
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.slice(prefix.length)
          const name = relative.split('/')[0]
          if (name && !entries.some(e => e.name === name)) {
            entries.push({ name, isDirectory: false })
          }
        }
      }

      // Find subdirectories
      for (const dir of dirs) {
        if (dir.startsWith(prefix) && dir !== prefix.slice(0, -1)) {
          const relative = dir.slice(prefix.length)
          const name = relative.split('/')[0]
          if (name && !entries.some(e => e.name === name)) {
            entries.push({ name, isDirectory: true })
          }
        }
      }

      return entries
    }),

    stat: vi.fn().mockImplementation(async (path: string) => {
      const file = files.get(path)
      if (!file) throw new Error(`File not found: ${path}`)
      return {
        size: file.size,
        mtime: file.mtime,
        isDirectory: () => dirs.has(path),
      }
    }),

    exists: vi.fn().mockImplementation(async (path: string) => {
      return files.has(path) || dirs.has(path)
    }),

    // Test helpers
    _getFiles: () => new Map(files),
    _getDirs: () => new Set(dirs),
    _reset: () => {
      files.clear()
      dirs.clear()
      dirs.add('/')
    },
  }
}

/**
 * Create mock git capability.
 * Simulates gitx behavior with in-memory state.
 */
function createMockGit() {
  let branch = 'main'
  let head: string | undefined
  const staged: string[] = []
  const commits: Array<{ hash: string; message: string; author: string; date: Date }> = []

  return {
    configure: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),

    status: vi.fn().mockImplementation(async () => ({
      branch,
      head,
      staged: [...staged],
      unstaged: [],
      untracked: [],
      clean: staged.length === 0,
    })),

    add: vi.fn().mockImplementation(async (paths: string | string[]) => {
      const pathArray = Array.isArray(paths) ? paths : [paths]
      if (pathArray.includes('.')) {
        staged.push('all')
      } else {
        staged.push(...pathArray)
      }
    }),

    commit: vi.fn().mockImplementation(async (message: string) => {
      const hash = 'commit_' + Date.now().toString(36) + '_' + commits.length
      commits.push({ hash, message, author: 'test@example.com', date: new Date() })
      head = hash
      staged.length = 0
      return { hash }
    }),

    sync: vi.fn().mockResolvedValue({
      success: true,
      objectsFetched: 5,
      filesWritten: 3,
      commit: 'synced_abc123',
    }),

    push: vi.fn().mockResolvedValue({
      success: true,
      objectsPushed: 3,
      commit: head,
    }),

    log: vi.fn().mockImplementation(async (options?: { limit?: number }) => {
      const limit = options?.limit ?? commits.length
      return commits.slice(0, limit)
    }),

    diff: vi.fn().mockResolvedValue(''),

    // Test helpers
    _setBranch: (b: string) => { branch = b },
    _getCommits: () => [...commits],
    _getStaged: () => [...staged],
    _reset: () => {
      branch = 'main'
      head = undefined
      staged.length = 0
      commits.length = 0
    },
  }
}

/**
 * Create mock bash capability.
 * Simulates bashx behavior with configurable responses.
 */
function createMockBash() {
  const commandResponses = new Map<string, { stdout: string; stderr: string; exitCode: number }>()

  // Default successful responses
  commandResponses.set('npm run build', { stdout: 'Build successful', stderr: '', exitCode: 0 })
  commandResponses.set('npm test', { stdout: '3 tests passed', stderr: '', exitCode: 0 })
  commandResponses.set('npm install', { stdout: 'Dependencies installed', stderr: '', exitCode: 0 })
  commandResponses.set('npm ci', { stdout: 'Dependencies installed (ci)', stderr: '', exitCode: 0 })
  commandResponses.set('npm run lint', { stdout: 'No lint errors', stderr: '', exitCode: 0 })

  return {
    exec: vi.fn().mockImplementation(async (command: string, args: string[] = []) => {
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
      const response = commandResponses.get(fullCommand) ?? {
        stdout: `Executed: ${fullCommand}`,
        stderr: '',
        exitCode: 0,
      }
      return response
    }),

    // Test helpers
    _setResponse: (cmd: string, response: { stdout: string; stderr: string; exitCode: number }) => {
      commandResponses.set(cmd, response)
    },
    _reset: () => {
      commandResponses.clear()
      commandResponses.set('npm run build', { stdout: 'Build successful', stderr: '', exitCode: 0 })
      commandResponses.set('npm test', { stdout: '3 tests passed', stderr: '', exitCode: 0 })
    },
  }
}

// ============================================================================
// Test Workspace Helper
// ============================================================================

/**
 * Create a test workspace that simulates DevWorkspaceDO behavior.
 * Uses mock primitives instead of real DO infrastructure.
 */
function createTestWorkspace() {
  const fs = createMockFs()
  const git = createMockGit()
  const bash = createMockBash()

  let projectName: string | null = null
  let lastBuildResult: any = null

  return {
    // Primitives
    $: { fs, git, bash },

    // Project Creation
    async createProject(config: {
      name: string
      description?: string
      template?: 'typescript-api' | 'minimal'
    }) {
      const { name, description = '', template = 'minimal' } = config
      const filesCreated: string[] = []

      try {
        // Create directories
        await fs.mkdir('/src', { recursive: true })
        await fs.mkdir('/dist', { recursive: true })

        // Write package.json
        const packageJson = JSON.stringify({
          name,
          version: '0.0.1',
          description,
          scripts: {
            build: 'tsc',
            test: 'vitest run',
          },
        }, null, 2)
        await fs.write('/package.json', packageJson)
        filesCreated.push('/package.json')

        // Write src/index.ts
        await fs.write('/src/index.ts', `// ${name}\nexport const hello = () => 'Hello!'`)
        filesCreated.push('/src/index.ts')

        // Write README
        await fs.write('/README.md', `# ${name}\n\n${description}`)
        filesCreated.push('/README.md')

        // Init git and commit
        await git.init()
        await git.add('.')
        await git.commit(`feat: initial project setup for ${name}`)

        projectName = name

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
    },

    // File Operations
    async addFiles(files: Array<{ path: string; content: string }>, options?: { commit?: boolean }) {
      const added: string[] = []

      for (const file of files) {
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await fs.mkdir(parentDir, { recursive: true })
        }
        await fs.write(file.path, file.content)
        added.push(file.path)
      }

      await git.add(added)

      if (options?.commit) {
        await git.commit(`feat: add ${added.length} file(s)`)
      }

      return { success: true, added }
    },

    async readFile(path: string) {
      try {
        const content = await fs.read(path)
        return { content }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    },

    async listFiles(path: string = '/') {
      const entries = await fs.list(path)
      return entries.map(e => e.name)
    },

    // Build & Test
    async build() {
      const startTime = Date.now()
      const result = await bash.exec('npm', ['run', 'build'])

      const buildResult = {
        success: result.exitCode === 0,
        buildOutput: result.stdout + result.stderr,
        duration: Date.now() - startTime,
      }

      lastBuildResult = buildResult
      return buildResult
    },

    async test() {
      const startTime = Date.now()
      const result = await bash.exec('npm', ['test'])

      return {
        success: result.exitCode === 0,
        testOutput: result.stdout + result.stderr,
        testsPassed: 3, // From mock
        testsFailed: 0,
        duration: Date.now() - startTime,
      }
    },

    async buildAndTest() {
      const buildResult = await this.build()
      if (!buildResult.success) return buildResult

      const testResult = await this.test()
      return {
        success: testResult.success,
        buildOutput: buildResult.buildOutput,
        testOutput: testResult.testOutput,
        testsPassed: testResult.testsPassed,
        testsFailed: testResult.testsFailed,
        duration: buildResult.duration + testResult.duration,
      }
    },

    // Dev Cycle
    async runDevCycle(options: {
      files: Array<{ path: string; content: string }>
      commitMessage: string
      push?: boolean
    }) {
      const steps: Array<{ name: string; success: boolean; output: string; duration: number }> = []
      const startTime = Date.now()

      // Write files
      const writeStart = Date.now()
      for (const file of options.files) {
        const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
        if (parentDir && parentDir !== '/') {
          await fs.mkdir(parentDir, { recursive: true })
        }
        await fs.write(file.path, file.content)
      }
      steps.push({
        name: 'write-files',
        success: true,
        output: `Wrote ${options.files.length} file(s)`,
        duration: Date.now() - writeStart,
      })

      // Build
      const buildStart = Date.now()
      const buildResult = await bash.exec('npm', ['run', 'build'])
      steps.push({
        name: 'build',
        success: buildResult.exitCode === 0,
        output: buildResult.stdout,
        duration: Date.now() - buildStart,
      })

      // Test
      const testStart = Date.now()
      const testResult = await bash.exec('npm', ['test'])
      steps.push({
        name: 'test',
        success: testResult.exitCode === 0,
        output: testResult.stdout,
        duration: Date.now() - testStart,
      })

      // Commit
      const commitStart = Date.now()
      await git.add('.')
      const commitResult = await git.commit(options.commitMessage)
      steps.push({
        name: 'commit',
        success: true,
        output: `Committed: ${commitResult.hash}`,
        duration: Date.now() - commitStart,
      })

      // Push
      if (options.push) {
        const pushStart = Date.now()
        const pushResult = await git.push()
        steps.push({
          name: 'push',
          success: pushResult.success,
          output: `Pushed ${pushResult.objectsPushed} objects`,
          duration: Date.now() - pushStart,
        })
      }

      return {
        success: true,
        steps,
        totalDuration: Date.now() - startTime,
        commit: commitResult.hash,
      }
    },

    // Status
    async getStatus() {
      const gitStatus = await git.status()
      const files = fs._getFiles()

      return {
        initialized: projectName !== null,
        projectName,
        git: {
          branch: gitStatus.branch,
          head: gitStatus.head,
          staged: gitStatus.staged,
          clean: gitStatus.clean,
        },
        files: {
          count: files.size,
          totalSize: Array.from(files.values()).reduce((sum, f) => sum + f.size, 0),
        },
      }
    },

    // Test helpers
    _reset: () => {
      fs._reset()
      git._reset()
      bash._reset()
      projectName = null
      lastBuildResult = null
    },
  }
}

// ============================================================================
// PROJECT CREATION TESTS
// ============================================================================

describe('Project Creation', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(() => {
    workspace = createTestWorkspace()
    workspace._reset()
  })

  it('creates a project with default template', async () => {
    const result = await workspace.createProject({
      name: 'my-app',
      description: 'A test application',
    })

    expect(result.success).toBe(true)
    expect(result.filesCreated).toContain('/package.json')
    expect(result.filesCreated).toContain('/src/index.ts')
    expect(result.filesCreated).toContain('/README.md')
    expect(result.message).toContain('my-app')
  })

  it('creates necessary directories', async () => {
    await workspace.createProject({ name: 'test-proj' })

    const dirs = workspace.$._fs?._getDirs ? workspace.$.fs._getDirs() : new Set()
    expect(dirs.has('/src')).toBe(true)
    expect(dirs.has('/dist')).toBe(true)
  })

  it('initializes git repository', async () => {
    await workspace.createProject({ name: 'git-proj' })

    expect(workspace.$.git.init).toHaveBeenCalled()
    expect(workspace.$.git.add).toHaveBeenCalledWith('.')
    expect(workspace.$.git.commit).toHaveBeenCalledWith(
      expect.stringContaining('initial project setup')
    )
  })

  it('creates valid package.json', async () => {
    await workspace.createProject({
      name: 'pkg-test',
      description: 'Package test',
    })

    const result = await workspace.readFile('/package.json')
    expect('content' in result).toBe(true)

    if ('content' in result) {
      const pkg = JSON.parse(result.content)
      expect(pkg.name).toBe('pkg-test')
      expect(pkg.description).toBe('Package test')
      expect(pkg.scripts).toBeDefined()
    }
  })
})

// ============================================================================
// FILE OPERATIONS TESTS
// ============================================================================

describe('File Operations', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(async () => {
    workspace = createTestWorkspace()
    workspace._reset()
    await workspace.createProject({ name: 'file-test' })
  })

  it('adds files to the workspace', async () => {
    const result = await workspace.addFiles([
      { path: '/src/utils.ts', content: 'export const util = () => {}' },
      { path: '/src/types.ts', content: 'export interface Thing {}' },
    ])

    expect(result.success).toBe(true)
    expect(result.added).toHaveLength(2)
    expect(result.added).toContain('/src/utils.ts')
    expect(result.added).toContain('/src/types.ts')
  })

  it('stages added files in git', async () => {
    await workspace.addFiles([
      { path: '/src/new.ts', content: '...' },
    ])

    expect(workspace.$.git.add).toHaveBeenCalledWith(['/src/new.ts'])
  })

  it('commits files when option is set', async () => {
    await workspace.addFiles(
      [{ path: '/src/feature.ts', content: '...' }],
      { commit: true }
    )

    expect(workspace.$.git.commit).toHaveBeenCalledWith(
      expect.stringContaining('add')
    )
  })

  it('reads files from workspace', async () => {
    await workspace.addFiles([
      { path: '/src/readable.ts', content: 'const x = 1' },
    ])

    const result = await workspace.readFile('/src/readable.ts')
    expect('content' in result).toBe(true)
    if ('content' in result) {
      expect(result.content).toBe('const x = 1')
    }
  })

  it('returns error for non-existent files', async () => {
    const result = await workspace.readFile('/does-not-exist.ts')
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('not found')
    }
  })

  it('lists files in directory', async () => {
    const files = await workspace.listFiles('/src')
    expect(files).toContain('index.ts')
  })

  it('creates parent directories for nested files', async () => {
    await workspace.addFiles([
      { path: '/src/utils/helpers/string.ts', content: '...' },
    ])

    expect(workspace.$.fs.mkdir).toHaveBeenCalledWith(
      '/src/utils/helpers',
      { recursive: true }
    )
  })
})

// ============================================================================
// BUILD & TEST TESTS
// ============================================================================

describe('Build & Test', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(async () => {
    workspace = createTestWorkspace()
    workspace._reset()
    await workspace.createProject({ name: 'build-test' })
  })

  it('runs build successfully', async () => {
    const result = await workspace.build()

    expect(result.success).toBe(true)
    expect(result.buildOutput).toContain('Build successful')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('runs tests successfully', async () => {
    const result = await workspace.test()

    expect(result.success).toBe(true)
    expect(result.testOutput).toContain('passed')
    expect(result.testsPassed).toBe(3)
    expect(result.testsFailed).toBe(0)
  })

  it('runs build and test together', async () => {
    const result = await workspace.buildAndTest()

    expect(result.success).toBe(true)
    expect(result.buildOutput).toBeDefined()
    expect(result.testOutput).toBeDefined()
  })

  it('reports build failures', async () => {
    workspace.$.bash._setResponse('npm run build', {
      stdout: '',
      stderr: 'Error: Compilation failed',
      exitCode: 1,
    })

    const result = await workspace.build()

    expect(result.success).toBe(false)
    expect(result.buildOutput).toContain('Compilation failed')
  })

  it('reports test failures', async () => {
    workspace.$.bash._setResponse('npm test', {
      stdout: '1 test failed',
      stderr: 'AssertionError',
      exitCode: 1,
    })

    const result = await workspace.test()

    expect(result.success).toBe(false)
  })

  it('stops buildAndTest on build failure', async () => {
    workspace.$.bash._setResponse('npm run build', {
      stdout: '',
      stderr: 'Build error',
      exitCode: 1,
    })

    const result = await workspace.buildAndTest()

    expect(result.success).toBe(false)
    expect(result.testOutput).toBeUndefined()
  })
})

// ============================================================================
// DEV CYCLE TESTS
// ============================================================================

describe('Development Cycle', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(async () => {
    workspace = createTestWorkspace()
    workspace._reset()
    await workspace.createProject({ name: 'cycle-test' })
  })

  it('executes full dev cycle', async () => {
    const result = await workspace.runDevCycle({
      files: [
        { path: '/src/feature.ts', content: 'export const feature = () => {}' },
      ],
      commitMessage: 'feat: add new feature',
    })

    expect(result.success).toBe(true)
    expect(result.steps.length).toBeGreaterThanOrEqual(4)
    expect(result.commit).toBeDefined()
  })

  it('includes all expected steps', async () => {
    const result = await workspace.runDevCycle({
      files: [{ path: '/src/x.ts', content: '...' }],
      commitMessage: 'test',
    })

    const stepNames = result.steps.map(s => s.name)
    expect(stepNames).toContain('write-files')
    expect(stepNames).toContain('build')
    expect(stepNames).toContain('test')
    expect(stepNames).toContain('commit')
  })

  it('includes push step when requested', async () => {
    const result = await workspace.runDevCycle({
      files: [{ path: '/src/push.ts', content: '...' }],
      commitMessage: 'feat: pushed feature',
      push: true,
    })

    const stepNames = result.steps.map(s => s.name)
    expect(stepNames).toContain('push')

    const pushStep = result.steps.find(s => s.name === 'push')
    expect(pushStep?.success).toBe(true)
  })

  it('creates files before building', async () => {
    await workspace.runDevCycle({
      files: [{ path: '/src/new-feature.ts', content: 'new code' }],
      commitMessage: 'feat: new feature',
    })

    const readResult = await workspace.readFile('/src/new-feature.ts')
    expect('content' in readResult).toBe(true)
    if ('content' in readResult) {
      expect(readResult.content).toBe('new code')
    }
  })

  it('commits with correct message', async () => {
    const commitMessage = 'fix: important bug fix'

    await workspace.runDevCycle({
      files: [{ path: '/src/fix.ts', content: '...' }],
      commitMessage,
    })

    expect(workspace.$.git.commit).toHaveBeenCalledWith(commitMessage)
  })

  it('calculates total duration', async () => {
    const result = await workspace.runDevCycle({
      files: [{ path: '/src/timed.ts', content: '...' }],
      commitMessage: 'test timing',
    })

    expect(result.totalDuration).toBeGreaterThanOrEqual(0)

    const stepDurations = result.steps.reduce((sum, s) => sum + s.duration, 0)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// STATUS & INSPECTION TESTS
// ============================================================================

describe('Status & Inspection', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(async () => {
    workspace = createTestWorkspace()
    workspace._reset()
  })

  it('reports uninitialized workspace', async () => {
    const status = await workspace.getStatus()

    expect(status.initialized).toBe(false)
    expect(status.projectName).toBe(null)
  })

  it('reports initialized workspace', async () => {
    await workspace.createProject({ name: 'status-test' })

    const status = await workspace.getStatus()

    expect(status.initialized).toBe(true)
    expect(status.projectName).toBe('status-test')
  })

  it('includes git status', async () => {
    await workspace.createProject({ name: 'git-status-test' })

    const status = await workspace.getStatus()

    expect(status.git).toBeDefined()
    expect(status.git.branch).toBe('main')
    expect(status.git.clean).toBe(true)
  })

  it('includes file counts', async () => {
    await workspace.createProject({ name: 'file-count-test' })

    const status = await workspace.getStatus()

    expect(status.files).toBeDefined()
    expect(status.files.count).toBeGreaterThan(0)
    expect(status.files.totalSize).toBeGreaterThan(0)
  })

  it('updates file count after adding files', async () => {
    await workspace.createProject({ name: 'count-update-test' })
    const initialStatus = await workspace.getStatus()
    const initialCount = initialStatus.files.count

    await workspace.addFiles([
      { path: '/src/extra1.ts', content: '...' },
      { path: '/src/extra2.ts', content: '...' },
    ])

    const updatedStatus = await workspace.getStatus()
    expect(updatedStatus.files.count).toBe(initialCount + 2)
  })
})

// ============================================================================
// INTEGRATION TESTS - ALL PRIMITIVES TOGETHER
// ============================================================================

describe('Multi-Tool Integration', () => {
  let workspace: ReturnType<typeof createTestWorkspace>

  beforeEach(() => {
    workspace = createTestWorkspace()
    workspace._reset()
  })

  it('demonstrates full workflow: create, develop, build, commit', async () => {
    // 1. Create project (uses fs + git)
    const createResult = await workspace.createProject({
      name: 'integration-test',
      description: 'Full integration test',
    })
    expect(createResult.success).toBe(true)

    // 2. Add feature files (uses fs + git)
    const addResult = await workspace.addFiles([
      { path: '/src/auth/login.ts', content: 'export async function login() {}' },
      { path: '/src/auth/logout.ts', content: 'export async function logout() {}' },
    ])
    expect(addResult.success).toBe(true)

    // 3. Build (uses bash)
    const buildResult = await workspace.build()
    expect(buildResult.success).toBe(true)

    // 4. Test (uses bash)
    const testResult = await workspace.test()
    expect(testResult.success).toBe(true)

    // 5. Run dev cycle (uses all three)
    const cycleResult = await workspace.runDevCycle({
      files: [
        { path: '/src/api/endpoints.ts', content: 'export const endpoints = {}' },
      ],
      commitMessage: 'feat: add API endpoints',
      push: true,
    })
    expect(cycleResult.success).toBe(true)

    // 6. Check final status (uses fs + git)
    const status = await workspace.getStatus()
    expect(status.initialized).toBe(true)
    expect(status.git.branch).toBe('main')
    expect(status.files.count).toBeGreaterThan(3)
  })

  it('handles errors gracefully across primitives', async () => {
    await workspace.createProject({ name: 'error-test' })

    // Set bash to fail
    workspace.$.bash._setResponse('npm run build', {
      stdout: '',
      stderr: 'Fatal error',
      exitCode: 1,
    })

    // Dev cycle should handle build failure
    const result = await workspace.buildAndTest()
    expect(result.success).toBe(false)

    // Workspace should still be usable
    const status = await workspace.getStatus()
    expect(status.initialized).toBe(true)
  })

  it('maintains consistency between fs and git', async () => {
    await workspace.createProject({ name: 'consistency-test' })

    // Add files through fs
    const files = [
      { path: '/src/a.ts', content: 'a' },
      { path: '/src/b.ts', content: 'b' },
    ]
    await workspace.addFiles(files, { commit: true })

    // Git should have commits
    const commits = workspace.$.git._getCommits()
    expect(commits.length).toBeGreaterThan(1)

    // Files should be readable
    const readA = await workspace.readFile('/src/a.ts')
    const readB = await workspace.readFile('/src/b.ts')
    expect('content' in readA && readA.content).toBe('a')
    expect('content' in readB && readB.content).toBe('b')
  })
})

// ============================================================================
// PRIMITIVE INTERACTION VERIFICATION
// ============================================================================

describe('Primitive Interaction Verification', () => {
  it('fs.write is called before git.add', async () => {
    const workspace = createTestWorkspace()
    const callOrder: string[] = []

    workspace.$.fs.write = vi.fn().mockImplementation(async () => {
      callOrder.push('fs.write')
    })
    workspace.$.git.add = vi.fn().mockImplementation(async () => {
      callOrder.push('git.add')
    })

    await workspace.addFiles([{ path: '/test.ts', content: '...' }])

    expect(callOrder[0]).toBe('fs.write')
    expect(callOrder[1]).toBe('git.add')
  })

  it('git.commit is called after git.add', async () => {
    const workspace = createTestWorkspace()
    const callOrder: string[] = []

    workspace.$.git.add = vi.fn().mockImplementation(async () => {
      callOrder.push('git.add')
    })
    workspace.$.git.commit = vi.fn().mockImplementation(async () => {
      callOrder.push('git.commit')
      return { hash: 'abc' }
    })

    await workspace.addFiles([{ path: '/test.ts', content: '...' }], { commit: true })

    const addIndex = callOrder.indexOf('git.add')
    const commitIndex = callOrder.indexOf('git.commit')
    expect(addIndex).toBeLessThan(commitIndex)
  })

  it('bash.exec is called for npm commands', async () => {
    const workspace = createTestWorkspace()
    await workspace.createProject({ name: 'bash-test' })

    await workspace.build()
    expect(workspace.$.bash.exec).toHaveBeenCalledWith('npm', ['run', 'build'])

    await workspace.test()
    expect(workspace.$.bash.exec).toHaveBeenCalledWith('npm', ['test'])
  })
})
