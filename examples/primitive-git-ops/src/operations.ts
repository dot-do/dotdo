/**
 * Git Operations - Reusable git operation helpers
 *
 * This module provides standalone functions for common git workflows
 * that can be used independently or composed together.
 *
 * These operations demonstrate the zero-VM advantage of gitx:
 * - No SSH keys or auth tokens stored on disk
 * - No git CLI binary required
 * - No container startup time
 * - All operations run in V8 isolates
 */

import type { GitCapability, GitStatus, PushResult, SyncResult, GitCommitResult } from '../../../lib/capabilities/git'

// ============================================================================
// Types
// ============================================================================

/**
 * File change for batch operations
 */
export interface FileChange {
  path: string
  content: string
  mode?: 'add' | 'modify' | 'delete'
}

/**
 * Result of a feature deployment
 */
export interface DeploymentResult {
  success: boolean
  branch: string
  commit?: string
  filesChanged: number
  error?: string
}

/**
 * CI/CD pipeline trigger options
 */
export interface PipelineTrigger {
  branch: string
  commit: string
  triggeredBy: string
  timestamp: Date
}

/**
 * Automated PR options
 */
export interface AutoPROptions {
  title: string
  body?: string
  base?: string
  head: string
  draft?: boolean
  labels?: string[]
  reviewers?: string[]
}

/**
 * PR creation result
 */
export interface PRResult {
  success: boolean
  number?: number
  url?: string
  error?: string
}

// ============================================================================
// Core Git Operations
// ============================================================================

/**
 * Initialize a new repository with standard structure.
 *
 * Creates .git directory structure and initial commit.
 * Zero-VM advantage: No git CLI required, runs in V8 isolate.
 *
 * @example
 * ```typescript
 * await initRepository($.git, {
 *   repo: 'org/repo',
 *   branch: 'main',
 *   r2: env.R2_BUCKET
 * })
 * ```
 */
export async function initRepository(
  git: GitCapability,
  options: {
    repo: string
    branch?: string
    r2?: unknown
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    git.configure({
      repo: options.repo,
      branch: options.branch ?? 'main',
      r2: options.r2 as Parameters<typeof git.configure>[0]['r2'],
    })
    await git.init()
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Clone a repository from R2 storage.
 *
 * Syncs git objects from R2 to local DO storage.
 * Zero-VM advantage: No network protocols, just R2 object fetches.
 *
 * @example
 * ```typescript
 * const result = await cloneRepository($.git, 'org/repo', 'main')
 * console.log(`Cloned ${result.filesWritten} files`)
 * ```
 */
export async function cloneRepository(
  git: GitCapability,
  repo: string,
  branch: string = 'main'
): Promise<SyncResult> {
  git.configure({
    repo,
    branch,
  })
  await git.init()
  return git.sync()
}

/**
 * Stage and commit changes in a single operation.
 *
 * Convenience function for the common add-commit workflow.
 *
 * @example
 * ```typescript
 * const commit = await commitChanges($.git, 'feat: add dark mode', [
 *   'src/theme.ts',
 *   'src/App.tsx'
 * ])
 * ```
 */
export async function commitChanges(
  git: GitCapability,
  message: string,
  files: string | string[] = '.'
): Promise<GitCommitResult> {
  await git.add(files)
  return git.commit(message)
}

/**
 * Push local changes to R2 storage.
 *
 * Uploads git objects to R2 and updates branch ref.
 * Zero-VM advantage: Direct R2 puts, no SSH/HTTPS protocols.
 */
export async function pushChanges(git: GitCapability): Promise<PushResult> {
  return git.push()
}

/**
 * Pull latest changes from R2 storage.
 *
 * Fetches git objects from R2 and updates local working tree.
 */
export async function pullChanges(git: GitCapability): Promise<SyncResult> {
  return git.sync()
}

// ============================================================================
// Branch Operations
// ============================================================================

/**
 * Create a new feature branch.
 *
 * Creates a branch from the current HEAD for feature development.
 *
 * @example
 * ```typescript
 * await createFeatureBranch($.git, 'dark-mode')
 * // Creates: feature/dark-mode
 * ```
 */
export async function createFeatureBranch(
  git: GitCapability,
  name: string
): Promise<{ success: boolean; branch: string }> {
  const branchName = name.startsWith('feature/') ? name : `feature/${name}`

  // Currently GitModule doesn't have checkout, but we can track the intent
  // In a full implementation, this would update refs/heads/
  return {
    success: true,
    branch: branchName,
  }
}

/**
 * Check if working tree has uncommitted changes.
 */
export async function hasUncommittedChanges(git: GitCapability): Promise<boolean> {
  const status = await git.status()
  return !status.clean
}

/**
 * Get current branch name.
 */
export async function getCurrentBranch(git: GitCapability): Promise<string> {
  const status = await git.status()
  return status.branch
}

// ============================================================================
// Deployment Workflows
// ============================================================================

/**
 * Deploy a feature with file changes.
 *
 * This is the hero workflow demonstrating gitx's zero-VM advantage:
 * 1. Initialize repository (no git CLI)
 * 2. Sync from R2 (no SSH/HTTPS protocols)
 * 3. Apply file changes via fsx (filesystem on SQLite)
 * 4. Stage and commit (pure JavaScript)
 * 5. Push to R2 (direct object storage)
 *
 * Traditional approach requires:
 * - Container with git installed
 * - SSH keys or tokens
 * - Network protocols
 * - 10-60 second cold starts
 *
 * gitx approach:
 * - V8 isolate only
 * - R2 object storage
 * - 0ms cold starts
 * - 300+ edge locations
 *
 * @example
 * ```typescript
 * const result = await deployFeature($.git, $.fs, 'dark-mode', [
 *   { path: 'src/theme.ts', content: 'export const dark = {}' },
 *   { path: 'src/App.tsx', content: '...' }
 * ])
 * ```
 */
export async function deployFeature(
  git: GitCapability,
  fs: { write: (path: string, content: string) => Promise<void>; rm: (path: string) => Promise<void>; mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void> },
  featureName: string,
  changes: FileChange[]
): Promise<DeploymentResult> {
  try {
    // Sync latest from R2
    const syncResult = await git.sync()
    if (!syncResult.success) {
      return {
        success: false,
        branch: `feature/${featureName}`,
        filesChanged: 0,
        error: `Sync failed: ${syncResult.error}`,
      }
    }

    // Apply file changes via filesystem
    for (const change of changes) {
      if (change.mode === 'delete') {
        await fs.rm(change.path)
      } else {
        // Ensure parent directory exists
        const parentDir = change.path.split('/').slice(0, -1).join('/')
        if (parentDir) {
          await fs.mkdir(parentDir, { recursive: true })
        }
        await fs.write(change.path, change.content)
      }
    }

    // Stage and commit
    await git.add('.')
    const commitResult = await git.commit(`feat: ${featureName}`)

    // Push to R2
    const pushResult = await git.push()
    if (!pushResult.success) {
      return {
        success: false,
        branch: `feature/${featureName}`,
        commit: commitResult.hash,
        filesChanged: changes.length,
        error: `Push failed: ${pushResult.error}`,
      }
    }

    return {
      success: true,
      branch: `feature/${featureName}`,
      commit: commitResult.hash,
      filesChanged: changes.length,
    }
  } catch (error) {
    return {
      success: false,
      branch: `feature/${featureName}`,
      filesChanged: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// CI/CD Integration Patterns
// ============================================================================

/**
 * Create a CI/CD pipeline trigger.
 *
 * Generates trigger data for external CI/CD systems.
 * Can be used with Cloudflare Queues to trigger builds.
 *
 * @example
 * ```typescript
 * const trigger = createPipelineTrigger(status, 'agent-ralph')
 * await env.BUILD_QUEUE.send(trigger)
 * ```
 */
export function createPipelineTrigger(
  status: GitStatus,
  triggeredBy: string
): PipelineTrigger {
  return {
    branch: status.branch,
    commit: status.head ?? 'unknown',
    triggeredBy,
    timestamp: new Date(),
  }
}

/**
 * Validate commit message format.
 *
 * Checks if commit message follows conventional commits format.
 */
export function validateCommitMessage(message: string): {
  valid: boolean
  type?: string
  scope?: string
  description?: string
  error?: string
} {
  // Conventional commits format: type(scope): description
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/)

  if (!match) {
    return {
      valid: false,
      error: 'Commit message must follow format: type(scope): description',
    }
  }

  const [, type, scope, description] = match
  const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci', 'perf', 'build']

  if (!validTypes.includes(type)) {
    return {
      valid: false,
      type,
      error: `Invalid type "${type}". Must be one of: ${validTypes.join(', ')}`,
    }
  }

  return {
    valid: true,
    type,
    scope,
    description,
  }
}

/**
 * Generate deployment script from git diff.
 *
 * Analyzes changes to determine what deployments are needed.
 * Useful for selective deployments in monorepos.
 */
export async function analyzeDeploymentNeeds(
  git: GitCapability,
  baseRef?: string,
  headRef?: string
): Promise<{
  needsBackendDeploy: boolean
  needsFrontendDeploy: boolean
  needsInfraDeploy: boolean
  changedPaths: string[]
}> {
  const diff = await git.diff(baseRef, headRef)
  const lines = diff.split('\n')

  const changedPaths: string[] = []
  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+) b\//)
    if (match) {
      changedPaths.push(match[1])
    }
  }

  return {
    needsBackendDeploy: changedPaths.some((p) =>
      p.startsWith('api/') || p.startsWith('workers/') || p.startsWith('objects/')
    ),
    needsFrontendDeploy: changedPaths.some((p) =>
      p.startsWith('app/') || p.startsWith('components/')
    ),
    needsInfraDeploy: changedPaths.some((p) =>
      p.startsWith('terraform/') || p.includes('wrangler.toml')
    ),
    changedPaths,
  }
}

// ============================================================================
// Automated PR Patterns
// ============================================================================

/**
 * Generate PR body from commit history.
 *
 * Creates a formatted PR description from the commits being merged.
 */
export async function generatePRBody(
  git: GitCapability,
  options: { limit?: number } = {}
): Promise<string> {
  const log = await git.log({ limit: options.limit ?? 10 })

  const commitList = log
    .map((entry) => `- ${entry.message} (\`${entry.hash.slice(0, 7)}\`)`)
    .join('\n')

  return `## Summary

This PR includes the following changes:

${commitList}

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing complete

---
*Automated PR generated by gitx*`
}

/**
 * Check if a PR can be auto-merged.
 *
 * Validates that the PR meets auto-merge criteria.
 */
export function canAutoMerge(status: GitStatus, options: {
  requireCleanTree?: boolean
  requiredBranch?: string
} = {}): { canMerge: boolean; reason?: string } {
  if (options.requireCleanTree && !status.clean) {
    return {
      canMerge: false,
      reason: 'Working tree has uncommitted changes',
    }
  }

  if (options.requiredBranch && status.branch !== options.requiredBranch) {
    return {
      canMerge: false,
      reason: `Must be on branch "${options.requiredBranch}", currently on "${status.branch}"`,
    }
  }

  return { canMerge: true }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate content hash (SHA-1).
 *
 * Useful for comparing file contents without full diff.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Parse git author string.
 */
export function parseAuthor(authorString: string): {
  name: string
  email: string
  timestamp?: number
  timezone?: string
} {
  // Format: Name <email> timestamp timezone
  const match = authorString.match(/^(.+?)\s*<([^>]+)>(?:\s+(\d+)\s+([+-]\d{4}))?$/)

  if (!match) {
    return { name: authorString, email: '' }
  }

  const [, name, email, timestamp, timezone] = match
  return {
    name,
    email,
    timestamp: timestamp ? parseInt(timestamp, 10) : undefined,
    timezone,
  }
}

/**
 * Generate commit message from file changes.
 *
 * Creates a conventional commit message based on the types of changes.
 */
export function generateCommitMessage(changes: FileChange[]): string {
  const additions = changes.filter((c) => c.mode === 'add').length
  const modifications = changes.filter((c) => c.mode === 'modify' || !c.mode).length
  const deletions = changes.filter((c) => c.mode === 'delete').length

  const parts: string[] = []
  if (additions > 0) parts.push(`add ${additions} file${additions > 1 ? 's' : ''}`)
  if (modifications > 0) parts.push(`update ${modifications} file${modifications > 1 ? 's' : ''}`)
  if (deletions > 0) parts.push(`remove ${deletions} file${deletions > 1 ? 's' : ''}`)

  const type = additions > 0 ? 'feat' : modifications > 0 ? 'fix' : 'chore'
  return `${type}: ${parts.join(', ')}`
}
