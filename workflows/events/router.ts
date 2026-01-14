/**
 * Events Router - Centralized event routing to DOs
 *
 * Consumes events from Cloudflare Queues and routes them to the
 * appropriate Durable Objects based on git bindings (repo/branch/path).
 *
 * Flow:
 *   git push → gitx → Queue → Events Router → target DO(s)
 *
 * The router queries the git table to find DOs that are subscribed
 * to the repo/path being pushed, then dispatches sync events.
 */

import { eq, and, like, or, isNull } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db'

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface GitPushEvent {
  type: 'git.push'
  repo: string // 'https://github.com/drivly/startups.studio'
  branch: string // 'main', 'feature/dark-mode'
  commit: string // SHA of new HEAD
  before: string // SHA of previous HEAD (for diff)
  commits: Array<{
    sha: string
    message: string
    author: { name: string; email: string }
    timestamp: string
    added: string[]
    modified: string[]
    removed: string[]
  }>
}

export interface GitBranchEvent {
  type: 'git.branch.created' | 'git.branch.deleted'
  repo: string
  branch: string
  commit?: string // SHA for creation, undefined for deletion
}

export interface GitTagEvent {
  type: 'git.tag.created' | 'git.tag.deleted'
  repo: string
  tag: string
  commit?: string
}

export type GitEvent = GitPushEvent | GitBranchEvent | GitTagEvent

// Routing result - which DOs to notify
export interface RouteResult {
  ns: string // DO namespace
  path: string // Path within repo this DO is bound to
  branch: string // Branch context
  event: GitEvent
  affectedFiles: string[] // Files that changed within this DO's path
}

// ============================================================================
// EVENTS ROUTER
// ============================================================================

export class EventsRouter {
  constructor(
    private db: DrizzleD1Database<typeof schema>,
    private doNamespace: DurableObjectNamespace,
  ) {}

  /**
   * Route a git event to all subscribed DOs
   */
  async route(event: GitEvent): Promise<RouteResult[]> {
    switch (event.type) {
      case 'git.push':
        return this.routePush(event)
      case 'git.branch.created':
        return this.routeBranchCreated(event)
      case 'git.branch.deleted':
        return this.routeBranchDeleted(event)
      case 'git.tag.created':
      case 'git.tag.deleted':
        return this.routeTag(event)
      default:
        return []
    }
  }

  /**
   * Route push event - find all DOs bound to this repo/branch/path
   */
  private async routePush(event: GitPushEvent): Promise<RouteResult[]> {
    // Get all files changed in this push
    const changedFiles = new Set<string>()
    for (const commit of event.commits) {
      commit.added.forEach((f) => changedFiles.add(f))
      commit.modified.forEach((f) => changedFiles.add(f))
      commit.removed.forEach((f) => changedFiles.add(f))
    }

    // Find all git bindings for this repo
    const bindings = await this.db
      .select()
      .from(schema.git)
      .where(eq(schema.git.repo, event.repo))

    const results: RouteResult[] = []

    for (const binding of bindings) {
      // Check if this push affects this binding's path
      const bindingPath = binding.path || ''
      const affectedFiles = Array.from(changedFiles).filter((file) =>
        bindingPath === '' ? true : file.startsWith(bindingPath + '/') || file === bindingPath,
      )

      if (affectedFiles.length === 0) continue

      // Check branch matching
      const branchMatches =
        binding.defaultBranch === event.branch ||
        (binding.branchPatterns && this.matchesBranchPattern(event.branch, binding.branchPatterns))

      if (!branchMatches) continue

      results.push({
        ns: binding.ns,
        path: bindingPath,
        branch: event.branch,
        event,
        affectedFiles: affectedFiles.map((f) =>
          bindingPath ? f.slice(bindingPath.length + 1) : f,
        ),
      })
    }

    return results
  }

  /**
   * Route branch creation - may need to create new preview DOs
   */
  private async routeBranchCreated(event: GitBranchEvent): Promise<RouteResult[]> {
    // Find bindings that have branchPatterns matching this new branch
    const bindings = await this.db
      .select()
      .from(schema.git)
      .where(eq(schema.git.repo, event.repo))

    const results: RouteResult[] = []

    for (const binding of bindings) {
      if (!binding.branchPatterns) continue
      if (!this.matchesBranchPattern(event.branch, binding.branchPatterns)) continue

      // This binding wants a preview DO for this branch
      results.push({
        ns: binding.ns,
        path: binding.path || '',
        branch: event.branch,
        event,
        affectedFiles: [], // Full sync needed for new branch
      })
    }

    return results
  }

  /**
   * Route branch deletion - clean up preview DOs
   */
  private async routeBranchDeleted(event: GitBranchEvent): Promise<RouteResult[]> {
    // Find gitBranches entries for this repo/branch
    const branches = await this.db
      .select()
      .from(schema.gitBranches)
      .where(eq(schema.gitBranches.branch, event.branch))

    const results: RouteResult[] = []

    for (const branch of branches) {
      results.push({
        ns: branch.bindingNs,
        path: '',
        branch: event.branch,
        event,
        affectedFiles: [],
      })
    }

    return results
  }

  /**
   * Route tag events
   */
  private async routeTag(event: GitTagEvent): Promise<RouteResult[]> {
    // Tags typically don't create new DOs, but may trigger deployments
    // For now, route to all bindings for this repo
    const bindings = await this.db
      .select()
      .from(schema.git)
      .where(eq(schema.git.repo, event.repo))

    return bindings.map((binding) => ({
      ns: binding.ns,
      path: binding.path || '',
      branch: 'main', // Tags apply to whatever branch they're on
      event,
      affectedFiles: [],
    }))
  }

  /**
   * Check if a branch matches a pattern (glob-style)
   * e.g., 'feature/*' matches 'feature/dark-mode'
   */
  private matchesBranchPattern(branch: string, patterns: string): boolean {
    const patternList = patterns.split(',').map((p) => p.trim())
    return patternList.some((pattern) => {
      if (pattern === '*') return true
      if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2)
        return branch.startsWith(prefix + '/')
      }
      return branch === pattern
    })
  }

  /**
   * Dispatch events to target DOs
   */
  async dispatch(results: RouteResult[]): Promise<void> {
    const dispatches = results.map(async (result) => {
      const doId = this.doNamespace.idFromName(result.ns)
      const stub = this.doNamespace.get(doId)

      // Send sync request to the DO
      await stub.fetch(
        new Request('https://internal/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'git.sync',
            branch: result.branch,
            commit: 'commit' in result.event ? result.event.commit : undefined,
            affectedFiles: result.affectedFiles,
            event: result.event,
          }),
        }),
      )
    })

    await Promise.allSettled(dispatches)
  }
}

// ============================================================================
// QUEUE HANDLER
// ============================================================================

/**
 * Cloudflare Queue consumer for git events
 */
export async function handleQueue(
  batch: MessageBatch<GitEvent>,
  env: { DB: D1Database; DO: DurableObjectNamespace },
): Promise<void> {
  const { drizzle } = await import('drizzle-orm/d1')
  const db = drizzle(env.DB, { schema })
  const router = new EventsRouter(db, env.DO)

  for (const message of batch.messages) {
    try {
      const results = await router.route(message.body)
      await router.dispatch(results)
      message.ack()
    } catch (error) {
      console.error('Failed to process git event:', error)
      message.retry()
    }
  }
}
