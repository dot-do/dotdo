/**
 * @dotdo/gcs/lifecycle - Object Lifecycle Management
 *
 * Google Cloud Storage compatible lifecycle management for automatic
 * object transitions and deletions.
 *
 * @example
 * ```typescript
 * import { LifecycleManager, LifecycleBuilder } from '@dotdo/gcs/lifecycle'
 *
 * // Build lifecycle rules
 * const rules = new LifecycleBuilder()
 *   .deleteOlderThan(30)
 *   .transitionToNearline(7)
 *   .transitionToColdline(30)
 *   .deleteByPrefix('tmp/', 1)
 *   .build()
 *
 * // Apply to bucket
 * await bucket.setLifecycle(rules)
 * ```
 */

import type {
  LifecycleRule,
  LifecycleAction,
  LifecycleCondition,
  StorageClass,
  InternalFile,
  BucketMetadata,
} from './types'

import { StorageBackend } from './backend'

// =============================================================================
// Lifecycle Builder
// =============================================================================

/**
 * Fluent builder for lifecycle rules
 */
export class LifecycleBuilder {
  private rules: LifecycleRule[] = []

  /**
   * Delete objects older than specified days
   */
  deleteOlderThan(days: number, options?: LifecycleConditionOptions): this {
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        age: days,
        ...this.buildConditionOptions(options),
      },
    })
    return this
  }

  /**
   * Delete objects by prefix
   */
  deleteByPrefix(prefix: string, ageDays?: number): this {
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        matchesPrefix: [prefix],
        ...(ageDays !== undefined ? { age: ageDays } : {}),
      },
    })
    return this
  }

  /**
   * Delete objects by suffix
   */
  deleteBySuffix(suffix: string, ageDays?: number): this {
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        matchesSuffix: [suffix],
        ...(ageDays !== undefined ? { age: ageDays } : {}),
      },
    })
    return this
  }

  /**
   * Delete noncurrent versions older than specified days
   */
  deleteNoncurrentVersions(days: number): this {
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        daysSinceNoncurrentTime: days,
        isLive: false,
      },
    })
    return this
  }

  /**
   * Delete objects created before a specific date
   */
  deleteCreatedBefore(date: Date | string): this {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0]
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        createdBefore: dateStr,
      },
    })
    return this
  }

  /**
   * Keep only the N newest versions
   */
  keepNewestVersions(count: number): this {
    this.rules.push({
      action: { type: 'Delete' },
      condition: {
        numNewerVersions: count,
        isLive: false,
      },
    })
    return this
  }

  /**
   * Transition to Nearline storage class
   */
  transitionToNearline(ageDays: number, options?: LifecycleConditionOptions): this {
    return this.transitionToStorageClass('NEARLINE', ageDays, options)
  }

  /**
   * Transition to Coldline storage class
   */
  transitionToColdline(ageDays: number, options?: LifecycleConditionOptions): this {
    return this.transitionToStorageClass('COLDLINE', ageDays, options)
  }

  /**
   * Transition to Archive storage class
   */
  transitionToArchive(ageDays: number, options?: LifecycleConditionOptions): this {
    return this.transitionToStorageClass('ARCHIVE', ageDays, options)
  }

  /**
   * Transition to a specific storage class
   */
  transitionToStorageClass(
    storageClass: StorageClass,
    ageDays: number,
    options?: LifecycleConditionOptions
  ): this {
    this.rules.push({
      action: { type: 'SetStorageClass', storageClass },
      condition: {
        age: ageDays,
        ...this.buildConditionOptions(options),
      },
    })
    return this
  }

  /**
   * Abort incomplete multipart uploads
   */
  abortIncompleteMultipartUploads(ageDays: number): this {
    this.rules.push({
      action: { type: 'AbortIncompleteMultipartUpload' },
      condition: {
        age: ageDays,
      },
    })
    return this
  }

  /**
   * Add a custom rule
   */
  addRule(action: LifecycleAction, condition: LifecycleCondition): this {
    this.rules.push({ action, condition })
    return this
  }

  /**
   * Build the final rules array
   */
  build(): LifecycleRule[] {
    return [...this.rules]
  }

  /**
   * Clear all rules
   */
  clear(): this {
    this.rules = []
    return this
  }

  private buildConditionOptions(options?: LifecycleConditionOptions): Partial<LifecycleCondition> {
    if (!options) return {}
    return {
      matchesPrefix: options.prefixes,
      matchesSuffix: options.suffixes,
      matchesStorageClass: options.storageClasses,
      isLive: options.isLive,
    }
  }
}

export interface LifecycleConditionOptions {
  prefixes?: string[]
  suffixes?: string[]
  storageClasses?: StorageClass[]
  isLive?: boolean
}

// =============================================================================
// Lifecycle Evaluator
// =============================================================================

/**
 * Evaluates lifecycle rules against objects
 */
export class LifecycleEvaluator {
  private rules: LifecycleRule[]

  constructor(rules: LifecycleRule[]) {
    this.rules = rules
  }

  /**
   * Evaluate all rules against a file and return matching actions
   */
  evaluate(file: InternalFile): LifecycleAction[] {
    const matchingActions: LifecycleAction[] = []

    for (const rule of this.rules) {
      if (this.matchesCondition(file, rule.condition)) {
        matchingActions.push(rule.action)
      }
    }

    return matchingActions
  }

  /**
   * Check if a file should be deleted based on lifecycle rules
   */
  shouldDelete(file: InternalFile): boolean {
    const actions = this.evaluate(file)
    return actions.some((a) => a.type === 'Delete')
  }

  /**
   * Get the target storage class for transition, if any
   */
  getTargetStorageClass(file: InternalFile): StorageClass | null {
    const actions = this.evaluate(file)
    const transition = actions.find((a) => a.type === 'SetStorageClass')
    return transition?.storageClass || null
  }

  /**
   * Check if a file matches a lifecycle condition
   */
  private matchesCondition(file: InternalFile, condition: LifecycleCondition): boolean {
    const metadata = file.metadata
    const now = new Date()

    // Age condition
    if (condition.age !== undefined) {
      const created = metadata.timeCreated ? new Date(metadata.timeCreated) : null
      if (!created) return false
      const ageInDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      if (ageInDays < condition.age) return false
    }

    // Created before condition
    if (condition.createdBefore) {
      const created = metadata.timeCreated ? new Date(metadata.timeCreated) : null
      if (!created) return false
      const threshold = new Date(condition.createdBefore)
      if (created >= threshold) return false
    }

    // Custom time before condition
    if (condition.customTimeBefore) {
      const customTime = metadata.customTime ? new Date(metadata.customTime) : null
      if (!customTime) return false
      const threshold = new Date(condition.customTimeBefore)
      if (customTime >= threshold) return false
    }

    // Days since custom time
    if (condition.daysSinceCustomTime !== undefined) {
      const customTime = metadata.customTime ? new Date(metadata.customTime) : null
      if (!customTime) return false
      const daysSince = (now.getTime() - customTime.getTime()) / (1000 * 60 * 60 * 24)
      if (daysSince < condition.daysSinceCustomTime) return false
    }

    // Days since noncurrent time (for versioned objects)
    if (condition.daysSinceNoncurrentTime !== undefined) {
      // This would check versioning state - simplified for compat layer
      if (condition.isLive !== false) return false
    }

    // Is live condition
    if (condition.isLive !== undefined) {
      // In a versioned bucket, check if this is the live version
      // Simplified: always consider current files as "live"
      const isLive = !file.versions || file.versions.length === 0
      if (condition.isLive !== isLive) return false
    }

    // Matches prefix condition
    if (condition.matchesPrefix && condition.matchesPrefix.length > 0) {
      const matchesAnyPrefix = condition.matchesPrefix.some((p) => file.name.startsWith(p))
      if (!matchesAnyPrefix) return false
    }

    // Matches suffix condition
    if (condition.matchesSuffix && condition.matchesSuffix.length > 0) {
      const matchesAnySuffix = condition.matchesSuffix.some((s) => file.name.endsWith(s))
      if (!matchesAnySuffix) return false
    }

    // Matches pattern condition (glob-like)
    if (condition.matchesPattern) {
      const regex = this.globToRegex(condition.matchesPattern)
      if (!regex.test(file.name)) return false
    }

    // Matches storage class condition
    if (condition.matchesStorageClass && condition.matchesStorageClass.length > 0) {
      const storageClass = metadata.storageClass || 'STANDARD'
      if (!condition.matchesStorageClass.includes(storageClass)) return false
    }

    // Number of newer versions (for version cleanup)
    if (condition.numNewerVersions !== undefined) {
      const newerVersions = file.versions?.filter((v) => v.isLive).length || 0
      if (newerVersions < condition.numNewerVersions) return false
    }

    return true
  }

  /**
   * Convert a glob pattern to a regex
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }
}

// =============================================================================
// Lifecycle Manager
// =============================================================================

/**
 * Manages lifecycle policies for a bucket
 */
export class LifecycleManager {
  private bucketName: string
  private backend: StorageBackend
  private evaluator: LifecycleEvaluator | null = null

  constructor(bucketName: string, backend: StorageBackend) {
    this.bucketName = bucketName
    this.backend = backend
  }

  /**
   * Load lifecycle rules from bucket metadata
   */
  async load(): Promise<LifecycleRule[]> {
    const bucket = await this.backend.getBucket(this.bucketName)
    const rules = bucket?.metadata.lifecycle?.rule || []
    this.evaluator = new LifecycleEvaluator(rules)
    return rules
  }

  /**
   * Set lifecycle rules for the bucket
   */
  async setRules(rules: LifecycleRule[]): Promise<void> {
    await this.backend.updateBucketMetadata(this.bucketName, {
      lifecycle: { rule: rules },
    })
    this.evaluator = new LifecycleEvaluator(rules)
  }

  /**
   * Clear all lifecycle rules
   */
  async clearRules(): Promise<void> {
    await this.backend.updateBucketMetadata(this.bucketName, {
      lifecycle: undefined,
    })
    this.evaluator = null
  }

  /**
   * Add a single rule
   */
  async addRule(rule: LifecycleRule): Promise<void> {
    const currentRules = await this.load()
    currentRules.push(rule)
    await this.setRules(currentRules)
  }

  /**
   * Remove rules matching a condition
   */
  async removeRules(predicate: (rule: LifecycleRule) => boolean): Promise<number> {
    const currentRules = await this.load()
    const newRules = currentRules.filter((r) => !predicate(r))
    const removed = currentRules.length - newRules.length
    await this.setRules(newRules)
    return removed
  }

  /**
   * Run lifecycle evaluation on all objects
   * This is typically done by the storage system automatically,
   * but can be triggered manually for testing
   */
  async runEvaluation(): Promise<LifecycleEvaluationResult> {
    if (!this.evaluator) {
      await this.load()
    }
    if (!this.evaluator) {
      return { deleted: [], transitioned: [], errors: [] }
    }

    const result: LifecycleEvaluationResult = {
      deleted: [],
      transitioned: [],
      errors: [],
    }

    // Get all files in the bucket
    const { files } = await this.backend.listFiles(this.bucketName)

    for (const file of files) {
      try {
        const actions = this.evaluator.evaluate(file)

        for (const action of actions) {
          if (action.type === 'Delete') {
            await this.backend.deleteFile(this.bucketName, file.name)
            result.deleted.push(file.name)
            break // Don't process more actions if deleted
          } else if (action.type === 'SetStorageClass' && action.storageClass) {
            await this.backend.updateFileMetadata(this.bucketName, file.name, {
              storageClass: action.storageClass,
              timeStorageClassUpdated: new Date().toISOString(),
            })
            result.transitioned.push({
              name: file.name,
              storageClass: action.storageClass,
            })
          }
        }
      } catch (error) {
        result.errors.push({
          name: file.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return result
  }

  /**
   * Preview what would happen if lifecycle rules were applied
   */
  async previewEvaluation(): Promise<LifecycleEvaluationResult> {
    if (!this.evaluator) {
      await this.load()
    }
    if (!this.evaluator) {
      return { deleted: [], transitioned: [], errors: [] }
    }

    const result: LifecycleEvaluationResult = {
      deleted: [],
      transitioned: [],
      errors: [],
    }

    const { files } = await this.backend.listFiles(this.bucketName)

    for (const file of files) {
      const actions = this.evaluator.evaluate(file)

      for (const action of actions) {
        if (action.type === 'Delete') {
          result.deleted.push(file.name)
          break
        } else if (action.type === 'SetStorageClass' && action.storageClass) {
          result.transitioned.push({
            name: file.name,
            storageClass: action.storageClass,
          })
        }
      }
    }

    return result
  }
}

export interface LifecycleEvaluationResult {
  deleted: string[]
  transitioned: Array<{ name: string; storageClass: StorageClass }>
  errors: Array<{ name: string; error: string }>
}

// =============================================================================
// Predefined Lifecycle Templates
// =============================================================================

/**
 * Common lifecycle rule templates
 */
export const LifecycleTemplates = {
  /**
   * Standard tiered storage with automatic transitions
   */
  tieredStorage(options?: {
    nearlineAfterDays?: number
    coldlineAfterDays?: number
    archiveAfterDays?: number
    deleteAfterDays?: number
  }): LifecycleRule[] {
    const builder = new LifecycleBuilder()
    const opts = {
      nearlineAfterDays: 30,
      coldlineAfterDays: 90,
      archiveAfterDays: 365,
      ...options,
    }

    builder.transitionToNearline(opts.nearlineAfterDays)
    builder.transitionToColdline(opts.coldlineAfterDays)
    builder.transitionToArchive(opts.archiveAfterDays)

    if (opts.deleteAfterDays) {
      builder.deleteOlderThan(opts.deleteAfterDays)
    }

    return builder.build()
  },

  /**
   * Log retention with auto-cleanup
   */
  logRetention(retentionDays: number): LifecycleRule[] {
    return new LifecycleBuilder()
      .deleteOlderThan(retentionDays, { prefixes: ['logs/'] })
      .build()
  },

  /**
   * Temporary file cleanup
   */
  tempFileCleanup(maxAgeDays: number = 1): LifecycleRule[] {
    return new LifecycleBuilder()
      .deleteByPrefix('tmp/', maxAgeDays)
      .deleteByPrefix('temp/', maxAgeDays)
      .deleteBySuffix('.tmp', maxAgeDays)
      .build()
  },

  /**
   * Version cleanup keeping only N versions
   */
  versionCleanup(keepVersions: number): LifecycleRule[] {
    return new LifecycleBuilder()
      .keepNewestVersions(keepVersions)
      .build()
  },

  /**
   * Multipart upload cleanup
   */
  multipartCleanup(maxAgeDays: number = 7): LifecycleRule[] {
    return new LifecycleBuilder()
      .abortIncompleteMultipartUploads(maxAgeDays)
      .build()
  },

  /**
   * GDPR-style data retention
   */
  gdprCompliance(retentionYears: number): LifecycleRule[] {
    const retentionDays = retentionYears * 365
    return new LifecycleBuilder()
      .deleteOlderThan(retentionDays)
      .build()
  },
}
