/**
 * DevOpsDO - Production DevOps Durable Object
 *
 * Combines all extended primitives for complete CI/CD pipelines:
 * - $.fs: SQLite-backed filesystem with R2 tiering
 * - $.git: Git version control with R2 object storage
 * - $.bash: Safe shell execution with command analysis
 * - $.npm: Package management and script execution
 *
 * Real DevOps patterns:
 * - Hotfix deployment with testing
 * - Scheduled dependency updates
 * - Blue-green deployments
 * - Rollback capabilities
 * - Audit logging
 */

import { DOWithPrimitives } from 'dotdo/presets'
import type { PrimitivesContext } from 'dotdo/presets'

// ============================================================================
// TYPES
// ============================================================================

interface DeployResult {
  success: boolean
  deployed: boolean
  commit?: string
  duration: number
  logs: string[]
  error?: string
}

interface HotfixResult extends DeployResult {
  issueId: string
  filesModified: string[]
  testsRun: number
  testsPassed: number
}

interface RollbackResult {
  success: boolean
  rolledBackTo: string
  previousCommit: string
  duration: number
}

interface DependencyUpdateResult {
  success: boolean
  prCreated: boolean
  prUrl?: string
  updatedPackages: string[]
  branch: string
}

interface BuildResult {
  success: boolean
  exitCode: number
  duration: number
  stdout: string
  stderr: string
  artifacts?: string[]
}

interface DeploymentSlot {
  name: 'blue' | 'green'
  commit: string
  deployedAt: Date
  active: boolean
}

interface AuditEntry {
  timestamp: Date
  action: string
  actor: string
  details: Record<string, unknown>
  success: boolean
}

// ============================================================================
// ENVIRONMENT
// ============================================================================

interface Env {
  R2_BUCKET: R2Bucket
  GITHUB_TOKEN?: string
  NPM_TOKEN?: string
  DEPLOY_KEY?: string
  ENVIRONMENT: string
}

// ============================================================================
// DEVOPS DURABLE OBJECT
// ============================================================================

export class DevOpsDO extends DOWithPrimitives<Env> {
  static readonly $type = 'DevOpsDO'

  // Audit log stored in memory (in production, persist to $.fs)
  private auditLog: AuditEntry[] = []

  // Blue-green deployment slots
  private slots: Map<string, DeploymentSlot> = new Map()

  // Get typed primitives context
  private get primitives(): PrimitivesContext {
    return this.getPrimitivesContext()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the DevOps environment.
   * Sets up git configuration and creates necessary directories.
   */
  async initialize(config: {
    repo: string
    branch?: string
  }): Promise<{ initialized: boolean; message: string }> {
    const { repo, branch = 'main' } = config
    const $ = this.primitives

    try {
      // Configure git with R2 object storage
      $.git.configure({
        repo,
        branch,
        r2: this.env.R2_BUCKET as unknown as import('../../lib/mixins/git').R2BucketLike,
        fs: $.fs,
      })

      // Initialize git repository
      await $.git.init()

      // Create standard project directories
      await $.fs.mkdir('/src', { recursive: true })
      await $.fs.mkdir('/dist', { recursive: true })
      await $.fs.mkdir('/logs', { recursive: true })
      await $.fs.mkdir('/.deployments', { recursive: true })

      this.audit('initialize', 'system', { repo, branch }, true)

      return {
        initialized: true,
        message: `DevOps environment initialized for ${repo}@${branch}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.audit('initialize', 'system', { repo, branch, error: message }, false)
      return { initialized: false, message }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOTFIX DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Deploy a hotfix for a specific issue.
   *
   * Complete CI/CD pipeline:
   * 1. Find affected file
   * 2. Apply fix
   * 3. Run tests
   * 4. Commit and push
   * 5. Deploy to production
   *
   * @example
   * ```typescript
   * const result = await $.DevOps('prod').deployWithHotfix(
   *   'BUG-123',
   *   'Fix null pointer in user authentication'
   * )
   * ```
   */
  async deployWithHotfix(issueId: string, fixDescription: string): Promise<HotfixResult> {
    const startTime = Date.now()
    const logs: string[] = []
    const $ = this.primitives

    try {
      logs.push(`[${new Date().toISOString()}] Starting hotfix deployment for ${issueId}`)

      // 1. Sync latest from remote
      logs.push('Syncing from remote...')
      const syncResult = await $.git.sync()
      if (!syncResult.success) {
        throw new Error(`Failed to sync: ${syncResult.error}`)
      }
      logs.push(`Synced ${syncResult.objectsFetched} objects, ${syncResult.filesWritten} files`)

      // 2. Find the file to fix (search for issue reference in codebase)
      logs.push(`Searching for files related to ${issueId}...`)
      const targetFile = await this.findFileForIssue(issueId)
      logs.push(`Target file: ${targetFile}`)

      // 3. Read and apply fix
      logs.push('Applying fix...')
      const originalContent = await $.fs.read(targetFile)
      const fixedContent = this.applyFix(originalContent, fixDescription, issueId)
      await $.fs.write(targetFile, fixedContent)
      logs.push('Fix applied successfully')

      // 4. Run tests
      logs.push('Running tests...')
      const testResult = await $.bash.exec('npm', ['test'])
      const testsRun = this.countTests(testResult.stdout)
      const testsPassed = testResult.exitCode === 0 ? testsRun : 0

      if (testResult.exitCode !== 0) {
        // Rollback the fix
        await $.fs.write(targetFile, originalContent)
        throw new Error(`Tests failed:\n${testResult.stderr || testResult.stdout}`)
      }
      logs.push(`Tests passed: ${testsPassed}/${testsRun}`)

      // 5. Commit the fix
      logs.push('Committing changes...')
      await $.git.add(targetFile)
      const commitMessage = `fix(${issueId}): ${fixDescription.slice(0, 50)}`
      const commitResult = await $.git.commit(commitMessage)
      logs.push(`Committed: ${commitResult.hash.slice(0, 8)}`)

      // 6. Push to remote
      logs.push('Pushing to remote...')
      const pushResult = await $.git.push()
      if (!pushResult.success) {
        throw new Error(`Failed to push: ${pushResult.error}`)
      }
      logs.push(`Pushed ${pushResult.objectsPushed} objects`)

      // 7. Deploy to production
      logs.push('Deploying to production...')
      const deployResult = await $.bash.exec('npm', ['run', 'deploy:production'])
      if (deployResult.exitCode !== 0) {
        throw new Error(`Deploy failed:\n${deployResult.stderr}`)
      }
      logs.push('Deployment successful!')

      const duration = Date.now() - startTime
      logs.push(`Total duration: ${duration}ms`)

      this.audit('deployWithHotfix', 'system', {
        issueId,
        commit: commitResult.hash,
        duration,
      }, true)

      return {
        success: true,
        deployed: true,
        issueId,
        commit: commitResult.hash,
        filesModified: [targetFile],
        testsRun,
        testsPassed,
        duration,
        logs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logs.push(`ERROR: ${message}`)

      this.audit('deployWithHotfix', 'system', { issueId, error: message }, false)

      return {
        success: false,
        deployed: false,
        issueId,
        filesModified: [],
        testsRun: 0,
        testsPassed: 0,
        duration: Date.now() - startTime,
        logs,
        error: message,
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPENDENCY UPDATES (Scheduled)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update dependencies and create a PR.
   *
   * Scheduled to run daily at 3am:
   * ```typescript
   * $.every.day.at('3am')(async () => {
   *   await this.updateDependencies()
   * })
   * ```
   */
  async updateDependencies(): Promise<DependencyUpdateResult> {
    const $ = this.primitives
    const branchName = `deps-update-${Date.now()}`

    try {
      // 1. Create update branch
      await $.git.add('.')
      await $.git.commit('checkpoint before deps update')

      // 2. Run npm update
      const updateResult = await $.bash.exec('npm', ['update'])
      if (updateResult.exitCode !== 0) {
        throw new Error(`npm update failed: ${updateResult.stderr}`)
      }

      // 3. Get list of updated packages
      const outdatedResult = await $.bash.exec('npm', ['outdated', '--json'])
      const updatedPackages = this.parseUpdatedPackages(outdatedResult.stdout)

      if (updatedPackages.length === 0) {
        return {
          success: true,
          prCreated: false,
          updatedPackages: [],
          branch: branchName,
        }
      }

      // 4. Run tests to verify updates
      const testResult = await $.bash.exec('npm', ['test'])
      if (testResult.exitCode !== 0) {
        throw new Error('Tests failed after dependency update')
      }

      // 5. Commit changes
      await $.git.add('package.json')
      await $.git.add('package-lock.json')
      await $.git.commit(`chore(deps): update ${updatedPackages.length} packages\n\n${updatedPackages.join('\n')}`)

      // 6. Push branch
      await $.git.push()

      // 7. Create PR via GitHub API (simulated)
      const prUrl = await this.createPullRequest({
        title: `chore(deps): Update ${updatedPackages.length} dependencies`,
        body: `## Updated Packages\n\n${updatedPackages.map(p => `- ${p}`).join('\n')}\n\nAll tests passing.`,
        head: branchName,
        base: 'main',
      })

      this.audit('updateDependencies', 'scheduled', {
        updatedPackages,
        branch: branchName,
      }, true)

      return {
        success: true,
        prCreated: true,
        prUrl,
        updatedPackages,
        branch: branchName,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.audit('updateDependencies', 'scheduled', { error: message }, false)
      return {
        success: false,
        prCreated: false,
        updatedPackages: [],
        branch: branchName,
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BLUE-GREEN DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Deploy to the inactive slot (blue-green deployment).
   * Provides zero-downtime deployments with instant rollback.
   */
  async deployBlueGreen(): Promise<DeployResult> {
    const startTime = Date.now()
    const logs: string[] = []
    const $ = this.primitives

    try {
      // Determine which slot to deploy to
      const activeSlot = this.getActiveSlot()
      const targetSlot = activeSlot === 'blue' ? 'green' : 'blue'
      logs.push(`Active slot: ${activeSlot}, deploying to: ${targetSlot}`)

      // 1. Sync and build
      logs.push('Syncing from remote...')
      await $.git.sync()

      logs.push('Installing dependencies...')
      const installResult = await $.bash.exec('npm', ['ci'])
      if (installResult.exitCode !== 0) {
        throw new Error(`npm ci failed: ${installResult.stderr}`)
      }

      logs.push('Building...')
      const buildResult = await $.bash.exec('npm', ['run', 'build'])
      if (buildResult.exitCode !== 0) {
        throw new Error(`Build failed: ${buildResult.stderr}`)
      }

      // 2. Run tests
      logs.push('Running tests...')
      const testResult = await $.bash.exec('npm', ['test'])
      if (testResult.exitCode !== 0) {
        throw new Error(`Tests failed: ${testResult.stderr}`)
      }

      // 3. Deploy to target slot
      logs.push(`Deploying to ${targetSlot} slot...`)
      const deployResult = await $.bash.exec('npm', ['run', `deploy:${targetSlot}`])
      if (deployResult.exitCode !== 0) {
        throw new Error(`Deploy to ${targetSlot} failed: ${deployResult.stderr}`)
      }

      // 4. Health check on new deployment
      logs.push('Running health checks...')
      const healthResult = await $.bash.exec('npm', ['run', `health:${targetSlot}`])
      if (healthResult.exitCode !== 0) {
        throw new Error(`Health check failed: ${healthResult.stderr}`)
      }

      // 5. Switch traffic to new slot
      logs.push(`Switching traffic to ${targetSlot}...`)
      const status = await $.git.status()
      const commit = status.head || 'unknown'

      this.slots.set(targetSlot, {
        name: targetSlot,
        commit,
        deployedAt: new Date(),
        active: true,
      })

      // Deactivate old slot
      if (activeSlot) {
        const oldSlot = this.slots.get(activeSlot)
        if (oldSlot) {
          oldSlot.active = false
          this.slots.set(activeSlot, oldSlot)
        }
      }

      const duration = Date.now() - startTime
      logs.push(`Deployment complete in ${duration}ms`)

      this.audit('deployBlueGreen', 'system', {
        fromSlot: activeSlot,
        toSlot: targetSlot,
        commit,
        duration,
      }, true)

      return {
        success: true,
        deployed: true,
        commit,
        duration,
        logs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logs.push(`ERROR: ${message}`)
      this.audit('deployBlueGreen', 'system', { error: message }, false)
      return {
        success: false,
        deployed: false,
        duration: Date.now() - startTime,
        logs,
        error: message,
      }
    }
  }

  /**
   * Rollback to the previous deployment slot.
   */
  async rollback(): Promise<RollbackResult> {
    const startTime = Date.now()

    const activeSlot = this.getActiveSlot()
    const inactiveSlot = activeSlot === 'blue' ? 'green' : 'blue'

    const previousDeployment = this.slots.get(inactiveSlot)
    if (!previousDeployment) {
      return {
        success: false,
        rolledBackTo: '',
        previousCommit: '',
        duration: Date.now() - startTime,
      }
    }

    // Switch traffic back
    previousDeployment.active = true
    this.slots.set(inactiveSlot, previousDeployment)

    const currentDeployment = this.slots.get(activeSlot)
    if (currentDeployment) {
      currentDeployment.active = false
      this.slots.set(activeSlot, currentDeployment)
    }

    const duration = Date.now() - startTime

    this.audit('rollback', 'system', {
      fromSlot: activeSlot,
      toSlot: inactiveSlot,
      commit: previousDeployment.commit,
    }, true)

    return {
      success: true,
      rolledBackTo: previousDeployment.commit,
      previousCommit: currentDeployment?.commit || '',
      duration,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run the complete build pipeline.
   */
  async build(): Promise<BuildResult> {
    const startTime = Date.now()
    const $ = this.primitives

    try {
      // Install dependencies
      const installResult = await $.bash.exec('npm', ['ci'])
      if (installResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: installResult.exitCode,
          duration: Date.now() - startTime,
          stdout: installResult.stdout,
          stderr: installResult.stderr,
        }
      }

      // Lint
      const lintResult = await $.bash.exec('npm', ['run', 'lint'])
      if (lintResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: lintResult.exitCode,
          duration: Date.now() - startTime,
          stdout: lintResult.stdout,
          stderr: lintResult.stderr,
        }
      }

      // Typecheck
      const typecheckResult = await $.bash.exec('npm', ['run', 'typecheck'])
      if (typecheckResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: typecheckResult.exitCode,
          duration: Date.now() - startTime,
          stdout: typecheckResult.stdout,
          stderr: typecheckResult.stderr,
        }
      }

      // Build
      const buildResult = await $.bash.exec('npm', ['run', 'build'])
      if (buildResult.exitCode !== 0) {
        return {
          success: false,
          exitCode: buildResult.exitCode,
          duration: Date.now() - startTime,
          stdout: buildResult.stdout,
          stderr: buildResult.stderr,
        }
      }

      // List build artifacts
      const artifacts = await $.fs.list('/dist')
      const artifactPaths = artifacts.map(a => `/dist/${a.name}`)

      this.audit('build', 'system', { artifacts: artifactPaths.length }, true)

      return {
        success: true,
        exitCode: 0,
        duration: Date.now() - startTime,
        stdout: buildResult.stdout,
        stderr: '',
        artifacts: artifactPaths,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.audit('build', 'system', { error: message }, false)
      return {
        success: false,
        exitCode: 1,
        duration: Date.now() - startTime,
        stdout: '',
        stderr: message,
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CI/CD STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current deployment status.
   */
  async getStatus(): Promise<{
    git: { branch: string; head?: string; clean: boolean }
    slots: Record<string, DeploymentSlot>
    recentAudit: AuditEntry[]
  }> {
    const $ = this.primitives
    const status = await $.git.status()

    return {
      git: {
        branch: status.branch,
        head: status.head,
        clean: status.clean,
      },
      slots: Object.fromEntries(this.slots),
      recentAudit: this.auditLog.slice(-10),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find the file that needs to be fixed for a given issue.
   * In production, this would search the codebase for TODO/FIXME comments
   * or query an issue tracker API.
   */
  private async findFileForIssue(issueId: string): Promise<string> {
    const $ = this.primitives

    // Search for issue references in source files
    const srcFiles = await $.fs.list('/src')

    for (const file of srcFiles) {
      if (file.isDirectory) continue

      try {
        const content = await $.fs.read(`/src/${file.name}`)
        if (content.includes(issueId) || content.includes('TODO') || content.includes('FIXME')) {
          return `/src/${file.name}`
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // Default to main entry point
    return '/src/index.ts'
  }

  /**
   * Apply a fix to file content.
   * In production, this could use AI to generate the fix.
   */
  private applyFix(content: string, fixDescription: string, issueId: string): string {
    const timestamp = new Date().toISOString()

    // Add a fix header comment
    const fixHeader = `// Fix for ${issueId}: ${fixDescription}\n// Applied: ${timestamp}\n\n`

    // In a real implementation, AI would generate the actual code fix
    return fixHeader + content
  }

  /**
   * Count test results from stdout.
   */
  private countTests(stdout: string): number {
    // Parse test output (format varies by test runner)
    const match = stdout.match(/(\d+)\s+(?:tests?|specs?)\s+(?:passed|completed)/i)
    return match ? parseInt(match[1], 10) : 0
  }

  /**
   * Parse npm outdated output to get updated packages.
   */
  private parseUpdatedPackages(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout)
      return Object.keys(data)
    } catch {
      return []
    }
  }

  /**
   * Get the currently active deployment slot.
   */
  private getActiveSlot(): 'blue' | 'green' | null {
    for (const [name, slot] of this.slots) {
      if (slot.active) return name as 'blue' | 'green'
    }
    return null
  }

  /**
   * Create a pull request (simulated - would call GitHub API in production).
   */
  private async createPullRequest(options: {
    title: string
    body: string
    head: string
    base: string
  }): Promise<string> {
    // In production, use GitHub API:
    // const response = await fetch(`${this.env.GITHUB_API_URL}/repos/${repo}/pulls`, {...})
    return `https://github.com/org/repo/pull/123`
  }

  /**
   * Add entry to audit log.
   */
  private audit(
    action: string,
    actor: string,
    details: Record<string, unknown>,
    success: boolean
  ): void {
    this.auditLog.push({
      timestamp: new Date(),
      action,
      actor,
      details,
      success,
    })

    // Keep only last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000)
    }
  }
}
