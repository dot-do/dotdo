/**
 * @dotdo/sdk/deploy - Deployment Automation
 *
 * Utilities for deploying and managing dotdo applications
 * from CI/CD pipelines and automation scripts.
 *
 * @module @dotdo/sdk/deploy
 *
 * @example
 * ```typescript
 * import { deploy, waitForHealthy } from 'dotdo/sdk/deploy'
 *
 * // Deploy and wait for healthy
 * const result = await deploy({
 *   environment: 'production',
 *   waitForHealthy: true
 * })
 *
 * console.log(`Deployed to ${result.url}`)
 * ```
 */

import { DotdoClient, DotdoSDKError } from './client'

// ============================================================================
// Types
// ============================================================================

/**
 * Deployment environment.
 */
export type DeployEnvironment = 'development' | 'staging' | 'production'

/**
 * Deployment configuration.
 */
export interface DeployConfig {
  /** Target environment */
  environment: DeployEnvironment
  /** Wrangler configuration path (default: wrangler.jsonc or wrangler.toml) */
  configPath?: string
  /** Working directory */
  cwd?: string
  /** Wait for deployment to be healthy */
  waitForHealthy?: boolean
  /** Health check timeout in ms (default: 60000) */
  healthTimeout?: number
  /** Verbose output */
  verbose?: boolean
  /** Dry run - don't actually deploy */
  dryRun?: boolean
}

/**
 * Deployment result.
 */
export interface DeployResult {
  /** Whether deployment succeeded */
  success: boolean
  /** Deployed URL */
  url?: string
  /** Deployment ID */
  deploymentId?: string
  /** Error message if failed */
  error?: string
  /** Deployment duration in ms */
  duration: number
  /** Environment deployed to */
  environment: DeployEnvironment
}

/**
 * Health check result.
 */
export interface HealthCheckResult {
  /** Whether the service is healthy */
  healthy: boolean
  /** Status from health endpoint */
  status?: string
  /** Response time in ms */
  responseTime: number
  /** Error if unhealthy */
  error?: string
  /** Number of attempts made */
  attempts: number
}

/**
 * Migration configuration.
 */
export interface MigrationConfig {
  /** Base URL of the deployed service */
  baseUrl: string
  /** API key for authentication */
  apiKey?: string
  /** Migrations directory */
  migrationsDir?: string
  /** Dry run - show what would be migrated */
  dryRun?: boolean
  /** Verbose output */
  verbose?: boolean
}

/**
 * Migration result.
 */
export interface MigrationResult {
  /** Whether migration succeeded */
  success: boolean
  /** Applied migrations */
  applied: string[]
  /** Pending migrations */
  pending: string[]
  /** Error if failed */
  error?: string
}

// ============================================================================
// Deployment Functions
// ============================================================================

/**
 * Deploy a dotdo application.
 *
 * Uses wrangler under the hood to deploy to Cloudflare Workers.
 *
 * @param config - Deployment configuration
 * @returns Deployment result
 *
 * @example
 * ```typescript
 * const result = await deploy({
 *   environment: 'production',
 *   waitForHealthy: true
 * })
 *
 * if (!result.success) {
 *   console.error('Deployment failed:', result.error)
 *   process.exit(1)
 * }
 * ```
 */
export async function deploy(config: DeployConfig): Promise<DeployResult> {
  const startTime = Date.now()

  // Build wrangler command
  const args = ['wrangler', 'deploy']

  if (config.configPath) {
    args.push('-c', config.configPath)
  }

  if (config.environment !== 'production') {
    args.push('--env', config.environment)
  }

  if (config.dryRun) {
    args.push('--dry-run')
  }

  if (config.verbose) {
    console.log(`Deploying to ${config.environment}...`)
    console.log(`Command: ${args.join(' ')}`)
  }

  try {
    // Execute wrangler deploy
    const { spawn } = await import('child_process')

    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      const proc = spawn('npx', args, {
        cwd: config.cwd ?? process.cwd(),
        shell: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
        if (config.verbose) {
          process.stdout.write(data)
        }
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
        if (config.verbose) {
          process.stderr.write(data)
        }
      })

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? 1 })
      })
    })

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || 'Deployment failed',
        duration: Date.now() - startTime,
        environment: config.environment,
      }
    }

    // Extract URL from output
    const urlMatch = result.stdout.match(/https:\/\/[^\s]+\.workers\.dev/)
    const url = urlMatch?.[0]

    // Wait for healthy if requested
    if (config.waitForHealthy && url) {
      const healthResult = await waitForHealthy(url, {
        timeout: config.healthTimeout ?? 60000,
        verbose: config.verbose,
      })

      if (!healthResult.healthy) {
        return {
          success: false,
          url,
          error: `Deployment succeeded but health check failed: ${healthResult.error}`,
          duration: Date.now() - startTime,
          environment: config.environment,
        }
      }
    }

    return {
      success: true,
      url,
      duration: Date.now() - startTime,
      environment: config.environment,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
      environment: config.environment,
    }
  }
}

/**
 * Wait for a deployment to become healthy.
 *
 * @param url - Base URL to check
 * @param options - Health check options
 * @returns Health check result
 *
 * @example
 * ```typescript
 * const result = await waitForHealthy('https://my-app.workers.dev', {
 *   timeout: 30000,
 *   interval: 2000
 * })
 *
 * if (!result.healthy) {
 *   throw new Error(`Service unhealthy after ${result.attempts} attempts`)
 * }
 * ```
 */
export async function waitForHealthy(
  url: string,
  options?: {
    timeout?: number
    interval?: number
    verbose?: boolean
  }
): Promise<HealthCheckResult> {
  const timeout = options?.timeout ?? 60000
  const interval = options?.interval ?? 2000
  const startTime = Date.now()
  let attempts = 0

  while (Date.now() - startTime < timeout) {
    attempts++

    try {
      const checkStart = Date.now()
      const response = await fetch(`${url}/health`)
      const responseTime = Date.now() - checkStart

      if (response.ok) {
        const data = await response.json().catch(() => ({}))

        if (options?.verbose) {
          console.log(`Health check passed (attempt ${attempts}, ${responseTime}ms)`)
        }

        return {
          healthy: true,
          status: (data as { status?: string }).status,
          responseTime,
          attempts,
        }
      }

      if (options?.verbose) {
        console.log(`Health check failed (attempt ${attempts}): ${response.status}`)
      }
    } catch (error) {
      if (options?.verbose) {
        console.log(`Health check error (attempt ${attempts}): ${error instanceof Error ? error.message : 'Unknown'}`)
      }
    }

    await sleep(interval)
  }

  return {
    healthy: false,
    responseTime: 0,
    error: `Health check timed out after ${timeout}ms (${attempts} attempts)`,
    attempts,
  }
}

/**
 * Check if a deployment is healthy.
 *
 * @param url - Base URL to check
 * @returns Health check result
 */
export async function checkHealth(url: string): Promise<HealthCheckResult> {
  const startTime = Date.now()

  try {
    const response = await fetch(`${url}/health`)
    const responseTime = Date.now() - startTime

    if (response.ok) {
      const data = await response.json().catch(() => ({}))

      return {
        healthy: true,
        status: (data as { status?: string }).status,
        responseTime,
        attempts: 1,
      }
    }

    return {
      healthy: false,
      responseTime,
      error: `Health check returned ${response.status}`,
      attempts: 1,
    }
  } catch (error) {
    return {
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
      attempts: 1,
    }
  }
}

// ============================================================================
// CI/CD Helpers
// ============================================================================

/**
 * Environment configuration from CI/CD variables.
 */
export interface CIEnvironment {
  /** Detected CI provider */
  provider: 'github-actions' | 'gitlab-ci' | 'circleci' | 'jenkins' | 'unknown'
  /** Branch name */
  branch?: string
  /** Commit SHA */
  commitSha?: string
  /** Pull request number */
  prNumber?: string
  /** Is this a release/tag? */
  isRelease: boolean
  /** Tag name if release */
  tagName?: string
}

/**
 * Detect CI/CD environment from environment variables.
 *
 * @returns Detected CI environment
 */
export function detectCIEnvironment(): CIEnvironment {
  // GitHub Actions
  if (process.env.GITHUB_ACTIONS === 'true') {
    return {
      provider: 'github-actions',
      branch: process.env.GITHUB_REF_NAME,
      commitSha: process.env.GITHUB_SHA,
      prNumber: process.env.GITHUB_PR_NUMBER,
      isRelease: process.env.GITHUB_REF_TYPE === 'tag',
      tagName: process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined,
    }
  }

  // GitLab CI
  if (process.env.GITLAB_CI === 'true') {
    return {
      provider: 'gitlab-ci',
      branch: process.env.CI_COMMIT_REF_NAME,
      commitSha: process.env.CI_COMMIT_SHA,
      prNumber: process.env.CI_MERGE_REQUEST_IID,
      isRelease: !!process.env.CI_COMMIT_TAG,
      tagName: process.env.CI_COMMIT_TAG,
    }
  }

  // CircleCI
  if (process.env.CIRCLECI === 'true') {
    return {
      provider: 'circleci',
      branch: process.env.CIRCLE_BRANCH,
      commitSha: process.env.CIRCLE_SHA1,
      prNumber: process.env.CIRCLE_PULL_REQUEST?.split('/').pop(),
      isRelease: !!process.env.CIRCLE_TAG,
      tagName: process.env.CIRCLE_TAG,
    }
  }

  // Jenkins
  if (process.env.JENKINS_URL) {
    return {
      provider: 'jenkins',
      branch: process.env.GIT_BRANCH,
      commitSha: process.env.GIT_COMMIT,
      isRelease: false,
    }
  }

  return {
    provider: 'unknown',
    isRelease: false,
  }
}

/**
 * Determine deployment environment from CI context.
 *
 * @returns Target deployment environment
 */
export function determineDeployEnvironment(): DeployEnvironment {
  const ci = detectCIEnvironment()

  // Releases go to production
  if (ci.isRelease) {
    return 'production'
  }

  // Main/master branches go to staging
  if (ci.branch === 'main' || ci.branch === 'master') {
    return 'staging'
  }

  // Everything else is development
  return 'development'
}

// ============================================================================
// Rollback Support
// ============================================================================

/**
 * Rollback configuration.
 */
export interface RollbackConfig {
  /** Environment to rollback */
  environment: DeployEnvironment
  /** Specific version to rollback to (optional) */
  version?: string
  /** Wrangler configuration path */
  configPath?: string
  /** Working directory */
  cwd?: string
  /** Verbose output */
  verbose?: boolean
}

/**
 * Rollback result.
 */
export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean
  /** Version rolled back to */
  version?: string
  /** Error if failed */
  error?: string
}

/**
 * Rollback to a previous deployment.
 *
 * @param config - Rollback configuration
 * @returns Rollback result
 *
 * @example
 * ```typescript
 * const result = await rollback({
 *   environment: 'production',
 *   verbose: true
 * })
 * ```
 */
export async function rollback(config: RollbackConfig): Promise<RollbackResult> {
  const args = ['wrangler', 'rollback']

  if (config.configPath) {
    args.push('-c', config.configPath)
  }

  if (config.environment !== 'production') {
    args.push('--env', config.environment)
  }

  if (config.version) {
    args.push('--version', config.version)
  }

  if (config.verbose) {
    console.log(`Rolling back ${config.environment}...`)
    console.log(`Command: ${args.join(' ')}`)
  }

  try {
    const { spawn } = await import('child_process')

    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      const proc = spawn('npx', args, {
        cwd: config.cwd ?? process.cwd(),
        shell: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
        if (config.verbose) {
          process.stdout.write(data)
        }
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
        if (config.verbose) {
          process.stderr.write(data)
        }
      })

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code: code ?? 1 })
      })
    })

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || 'Rollback failed',
      }
    }

    return {
      success: true,
      version: config.version,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Validate deployment prerequisites.
 *
 * @returns Validation result
 */
export async function validatePrerequisites(): Promise<{
  valid: boolean
  errors: string[]
  warnings: string[]
}> {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for wrangler
  try {
    const { execSync } = await import('child_process')
    execSync('npx wrangler --version', { stdio: 'pipe' })
  } catch {
    errors.push('wrangler is not installed. Run: npm install -g wrangler')
  }

  // Check for wrangler config
  const fs = await import('fs')
  const configExists =
    fs.existsSync('wrangler.jsonc') ||
    fs.existsSync('wrangler.toml') ||
    fs.existsSync('wrangler.json')

  if (!configExists) {
    errors.push('No wrangler configuration found (wrangler.jsonc, wrangler.toml, or wrangler.json)')
  }

  // Check for Cloudflare auth
  if (!process.env.CLOUDFLARE_API_TOKEN && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    warnings.push('CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set - deployment may require interactive login')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Create deployment annotations for CI/CD.
 *
 * @param result - Deployment result
 * @returns Formatted annotations
 */
export function createDeploymentAnnotations(result: DeployResult): {
  summary: string
  details: string
} {
  const status = result.success ? 'succeeded' : 'failed'
  const duration = (result.duration / 1000).toFixed(2)

  const summary = `Deployment to ${result.environment} ${status} in ${duration}s`

  let details = `## Deployment ${result.success ? 'Successful' : 'Failed'}\n\n`
  details += `- **Environment:** ${result.environment}\n`
  details += `- **Duration:** ${duration}s\n`

  if (result.url) {
    details += `- **URL:** ${result.url}\n`
  }

  if (result.error) {
    details += `\n### Error\n\`\`\`\n${result.error}\n\`\`\`\n`
  }

  return { summary, details }
}
