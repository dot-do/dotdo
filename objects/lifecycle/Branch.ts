/**
 * Branch Lifecycle Module
 *
 * Handles git-like branching operations for Durable Objects:
 * - branch: Create a new branch at current HEAD
 * - checkout: Switch to a branch or version
 * - merge: Merge a branch into current
 */

import * as schema from '../../db'
import type { LifecycleContext, LifecycleModule } from './types'

/**
 * Branch lifecycle module implementing git-like version control.
 */
export class BranchModule implements LifecycleModule {
  private ctx!: LifecycleContext
  private _currentBranch: string = 'main'
  private _currentVersion: number | null = null

  initialize(context: LifecycleContext): void {
    this.ctx = context
    this._currentBranch = context.currentBranch
  }

  get currentBranch(): string {
    return this._currentBranch
  }

  set currentBranch(value: string) {
    this._currentBranch = value
  }

  get currentVersion(): number | null {
    return this._currentVersion
  }

  set currentVersion(value: number | null) {
    this._currentVersion = value
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new branch at current HEAD
   */
  async branch(name: string): Promise<{ name: string; head: number }> {
    // Validate branch name
    if (!name || name.trim() === '') {
      throw new Error('Branch name cannot be empty')
    }

    if (name.includes(' ')) {
      throw new Error('Branch name cannot contain spaces')
    }

    if (name === 'main') {
      throw new Error('Cannot create branch named "main" - it is reserved')
    }

    // Check if branch already exists
    const branches = await this.ctx.db.select().from(schema.branches)
    if (branches.some((b) => b.name === name)) {
      throw new Error(`Branch "${name}" already exists`)
    }

    // Find current HEAD (latest rowid on current branch)
    const things = await this.ctx.db.select().from(schema.things)
    const currentBranchThings = things.filter((t) =>
      this._currentBranch === 'main' ? t.branch === null : t.branch === this._currentBranch
    )

    if (currentBranchThings.length === 0) {
      throw new Error('No commits on current branch')
    }

    // Get the latest rowid (use array index as proxy for rowid)
    const head = currentBranchThings.length

    // Create branch record
    await this.ctx.db.insert(schema.branches).values({
      name,
      thingId: currentBranchThings[0]!.id,
      head,
      base: head,
      forkedFrom: this._currentBranch,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Emit branch.created event
    await this.ctx.emitEvent('branch.created', { name, head, forkedFrom: this._currentBranch })

    return { name, head }
  }

  /**
   * Switch to a branch or version
   * @param ref - Branch name or version reference (e.g., '@v1234', '@main', '@~1')
   */
  async checkout(ref: string): Promise<{ branch?: string; version?: number }> {
    const things = await this.ctx.db.select().from(schema.things)

    // Parse the ref
    let targetRef = ref.startsWith('@') ? ref.slice(1) : ref

    // Check for version reference (@v1234)
    if (targetRef.startsWith('v')) {
      const version = parseInt(targetRef.slice(1), 10)

      // Validate version exists (use index as proxy for rowid)
      if (version < 1 || version > things.length) {
        throw new Error(`Version not found: ${version}`)
      }

      // Set to detached HEAD state
      this._currentVersion = version

      // Emit checkout event
      await this.ctx.emitEvent('checkout', { version })

      return { version }
    }

    // Check for relative reference (@~N)
    if (targetRef.startsWith('~')) {
      const offset = parseInt(targetRef.slice(1), 10)

      // Get all things on current branch
      const currentBranchThings = things.filter((t) =>
        this._currentBranch === 'main' ? t.branch === null : t.branch === this._currentBranch
      )

      if (offset >= currentBranchThings.length) {
        throw new Error(
          `Cannot go back ${offset} versions - only ${currentBranchThings.length} versions exist`
        )
      }

      const version = currentBranchThings.length - offset

      // Set to detached HEAD state
      this._currentVersion = version

      // Emit checkout event
      await this.ctx.emitEvent('checkout', { version, relative: `~${offset}` })

      return { version }
    }

    // Branch reference
    const branchName = targetRef

    // Check if branch exists
    if (branchName === 'main') {
      this._currentBranch = 'main'
      this._currentVersion = null

      await this.ctx.emitEvent('checkout', { branch: 'main' })
      return { branch: 'main' }
    }

    // Check for explicit branch or things on that branch
    const branches = await this.ctx.db.select().from(schema.branches)
    const branchExists = branches.some((b) => b.name === branchName)
    const thingsOnBranch = things.filter((t) => t.branch === branchName)

    if (!branchExists && thingsOnBranch.length === 0) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    this._currentBranch = branchName
    this._currentVersion = null

    // Emit checkout event
    await this.ctx.emitEvent('checkout', { branch: branchName })

    return { branch: branchName }
  }

  /**
   * Merge a branch into current
   */
  async merge(branch: string): Promise<{ merged: boolean; conflicts?: string[] }> {
    // Cannot merge into detached HEAD
    if (this._currentVersion !== null) {
      throw new Error('Cannot merge into detached HEAD state')
    }

    // Cannot merge branch into itself
    if (branch === this._currentBranch || (branch === 'main' && this._currentBranch === 'main')) {
      throw new Error('Cannot merge branch into itself')
    }

    const things = await this.ctx.db.select().from(schema.things)
    const branches = await this.ctx.db.select().from(schema.branches)

    // Check if source branch exists
    const sourceBranch = branches.find((b) => b.name === branch)
    const sourceThings = things.filter((t) => t.branch === branch)

    if (!sourceBranch && sourceThings.length === 0) {
      throw new Error(`Branch not found: ${branch}`)
    }

    // Emit merge.started event
    await this.ctx.emitEvent('merge.started', { source: branch, target: this._currentBranch })

    // Get things on target branch (current)
    const targetBranchFilter = this._currentBranch === 'main' ? null : this._currentBranch
    const targetThings = things.filter((t) => t.branch === targetBranchFilter)

    // Find base (common ancestor)
    const baseRowid = sourceBranch?.base || 1

    // Group source and target things by id
    const sourceById = new Map<string, typeof things>()
    for (const t of sourceThings) {
      const group = sourceById.get(t.id) || []
      group.push(t)
      sourceById.set(t.id, group)
    }

    const targetById = new Map<string, typeof things>()
    for (const t of targetThings) {
      const group = targetById.get(t.id) || []
      group.push(t)
      targetById.set(t.id, group)
    }

    // Detect conflicts and prepare merge
    const conflicts: string[] = []
    const toMerge: typeof things = []

    for (const [id, sourceVersions] of sourceById) {
      const latestSource = sourceVersions[sourceVersions.length - 1]!
      const targetVersions = targetById.get(id) || []

      if (targetVersions.length === 0) {
        // Thing only exists on source - add to target
        toMerge.push({
          ...latestSource,
          branch: targetBranchFilter,
        } as (typeof things)[0])
      } else {
        // Thing exists on both - check for conflicts
        const latestTarget = targetVersions[targetVersions.length - 1]!

        // Compare changes
        const sourceData = (latestSource.data || {}) as Record<string, unknown>
        const targetData = (latestTarget.data || {}) as Record<string, unknown>
        const baseVersion = targetVersions[0] || sourceVersions[0]
        const baseData = (baseVersion?.data || {}) as Record<string, unknown>

        // Check for conflicting field changes
        const sourceChanges = new Set<string>()
        const targetChanges = new Set<string>()

        for (const key of Object.keys(sourceData)) {
          if (JSON.stringify(sourceData[key]) !== JSON.stringify(baseData[key])) {
            sourceChanges.add(key)
          }
        }

        for (const key of Object.keys(targetData)) {
          if (JSON.stringify(targetData[key]) !== JSON.stringify(baseData[key])) {
            targetChanges.add(key)
          }
        }

        // Check for overlapping changes (conflicts)
        const conflictingFields: string[] = []
        for (const field of sourceChanges) {
          if (
            targetChanges.has(field) &&
            JSON.stringify(sourceData[field]) !== JSON.stringify(targetData[field])
          ) {
            conflictingFields.push(field)
          }
        }

        if (conflictingFields.length > 0) {
          conflicts.push(`${id}:${conflictingFields.join(',')}`)
        } else {
          // Auto-merge non-conflicting changes
          const mergedData: Record<string, unknown> = { ...baseData }

          for (const field of sourceChanges) {
            mergedData[field] = sourceData[field]
          }

          for (const field of targetChanges) {
            mergedData[field] = targetData[field]
          }

          if (latestSource.deleted || latestTarget.deleted) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
              deleted: latestSource.deleted || latestTarget.deleted,
            } as (typeof things)[0])
          } else if (Object.keys(mergedData).length > 0 || sourceChanges.size > 0) {
            toMerge.push({
              ...latestTarget,
              data: mergedData,
            } as (typeof things)[0])
          }
        }
      }
    }

    // If there are conflicts, don't merge
    if (conflicts.length > 0) {
      await this.ctx.emitEvent('merge.conflict', { source: branch, conflicts })
      return { merged: false, conflicts }
    }

    // Apply merge - add new versions to target branch
    for (const thing of toMerge) {
      await this.ctx.db.insert(schema.things).values({
        id: thing.id,
        type: thing.type,
        branch: thing.branch,
        name: thing.name,
        data: thing.data as Record<string, unknown>,
        deleted: thing.deleted,
      })
    }

    // Emit merge.completed event
    await this.ctx.emitEvent('merge.completed', {
      source: branch,
      target: this._currentBranch,
      merged: toMerge.length,
    })

    return { merged: true }
  }
}

// Export singleton factory
export function createBranchModule(): BranchModule {
  return new BranchModule()
}
