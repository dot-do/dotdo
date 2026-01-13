/**
 * @dotdo/gcs/acl - Access Control Lists and IAM
 *
 * Google Cloud Storage compatible ACL and IAM management.
 *
 * @example
 * ```typescript
 * import { Acl, BucketAcl, FileAcl } from '@dotdo/gcs/acl'
 *
 * // Add ACL entry
 * await bucket.acl.add({
 *   entity: 'user-example@gmail.com',
 *   role: 'READER',
 * })
 *
 * // Get IAM policy
 * const [policy] = await bucket.iam.getPolicy()
 * ```
 */

import type {
  BucketAccessControl,
  ObjectAccessControl,
  AddAclOptions,
  Policy,
  PolicyBinding,
  PolicyCondition,
  PredefinedBucketAcl,
  PredefinedObjectAcl,
  TestIamPermissionsOptions,
} from './types'

import { StorageBackend } from './backend'
import {
  ApiError,
  BucketNotFoundError,
  FileNotFoundError,
  ForbiddenError,
  AclNotFoundError,
} from './errors'

// =============================================================================
// ACL Constants
// =============================================================================

/**
 * Well-known ACL entities
 */
export const ACL_ENTITIES = {
  /** All users (public) */
  ALL_USERS: 'allUsers',
  /** All authenticated users */
  ALL_AUTHENTICATED_USERS: 'allAuthenticatedUsers',
} as const

/**
 * ACL roles
 */
export const ACL_ROLES = {
  OWNER: 'OWNER',
  READER: 'READER',
  WRITER: 'WRITER',
} as const

/**
 * IAM roles
 */
export const IAM_ROLES = {
  /** Legacy bucket reader */
  LEGACY_BUCKET_READER: 'roles/storage.legacyBucketReader',
  /** Legacy bucket writer */
  LEGACY_BUCKET_WRITER: 'roles/storage.legacyBucketWriter',
  /** Legacy bucket owner */
  LEGACY_BUCKET_OWNER: 'roles/storage.legacyBucketOwner',
  /** Legacy object reader */
  LEGACY_OBJECT_READER: 'roles/storage.legacyObjectReader',
  /** Legacy object owner */
  LEGACY_OBJECT_OWNER: 'roles/storage.legacyObjectOwner',
  /** Object viewer */
  OBJECT_VIEWER: 'roles/storage.objectViewer',
  /** Object creator */
  OBJECT_CREATOR: 'roles/storage.objectCreator',
  /** Object admin */
  OBJECT_ADMIN: 'roles/storage.objectAdmin',
  /** Storage admin */
  ADMIN: 'roles/storage.admin',
} as const

// =============================================================================
// ACL Helpers
// =============================================================================

/**
 * Parse an entity string into its components
 */
export function parseEntity(entity: string): {
  type: 'user' | 'group' | 'domain' | 'project' | 'allUsers' | 'allAuthenticatedUsers'
  identifier?: string
} {
  if (entity === 'allUsers') {
    return { type: 'allUsers' }
  }
  if (entity === 'allAuthenticatedUsers') {
    return { type: 'allAuthenticatedUsers' }
  }

  if (entity.startsWith('user-')) {
    return { type: 'user', identifier: entity.slice(5) }
  }
  if (entity.startsWith('group-')) {
    return { type: 'group', identifier: entity.slice(6) }
  }
  if (entity.startsWith('domain-')) {
    return { type: 'domain', identifier: entity.slice(7) }
  }
  if (entity.startsWith('project-')) {
    const parts = entity.slice(8).split('-')
    return { type: 'project', identifier: parts.join('-') }
  }

  // Default to user if no prefix
  return { type: 'user', identifier: entity }
}

/**
 * Format an entity string
 */
export function formatEntity(
  type: 'user' | 'group' | 'domain' | 'project' | 'allUsers' | 'allAuthenticatedUsers',
  identifier?: string
): string {
  switch (type) {
    case 'allUsers':
      return 'allUsers'
    case 'allAuthenticatedUsers':
      return 'allAuthenticatedUsers'
    case 'user':
      return identifier ? `user-${identifier}` : 'user-unknown'
    case 'group':
      return identifier ? `group-${identifier}` : 'group-unknown'
    case 'domain':
      return identifier ? `domain-${identifier}` : 'domain-unknown'
    case 'project':
      return identifier ? `project-${identifier}` : 'project-unknown'
  }
}

/**
 * Convert predefined bucket ACL to ACL entries
 */
export function expandPredefinedBucketAcl(
  predefinedAcl: PredefinedBucketAcl,
  projectId?: string
): BucketAccessControl[] {
  const ownerEntity = projectId ? `project-owners-${projectId}` : 'project-owners'
  const editorEntity = projectId ? `project-editors-${projectId}` : 'project-editors'
  const viewerEntity = projectId ? `project-viewers-${projectId}` : 'project-viewers'

  switch (predefinedAcl) {
    case 'private':
      return [{ entity: ownerEntity, role: 'OWNER' }]

    case 'projectPrivate':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: editorEntity, role: 'WRITER' },
        { entity: viewerEntity, role: 'READER' },
      ]

    case 'authenticatedRead':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: 'allAuthenticatedUsers', role: 'READER' },
      ]

    case 'publicRead':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: 'allUsers', role: 'READER' },
      ]

    case 'publicReadWrite':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: 'allUsers', role: 'WRITER' },
      ]

    default:
      return [{ entity: ownerEntity, role: 'OWNER' }]
  }
}

/**
 * Convert predefined object ACL to ACL entries
 */
export function expandPredefinedObjectAcl(
  predefinedAcl: PredefinedObjectAcl,
  projectId?: string
): ObjectAccessControl[] {
  const ownerEntity = projectId ? `project-owners-${projectId}` : 'project-owners'

  switch (predefinedAcl) {
    case 'private':
      return [{ entity: ownerEntity, role: 'OWNER' }]

    case 'projectPrivate':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: projectId ? `project-editors-${projectId}` : 'project-editors', role: 'OWNER' },
        { entity: projectId ? `project-viewers-${projectId}` : 'project-viewers', role: 'READER' },
      ]

    case 'authenticatedRead':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: 'allAuthenticatedUsers', role: 'READER' },
      ]

    case 'publicRead':
      return [
        { entity: ownerEntity, role: 'OWNER' },
        { entity: 'allUsers', role: 'READER' },
      ]

    case 'bucketOwnerFullControl':
      return [{ entity: ownerEntity, role: 'OWNER' }]

    case 'bucketOwnerRead':
      return [
        { entity: ownerEntity, role: 'READER' },
      ]

    default:
      return [{ entity: ownerEntity, role: 'OWNER' }]
  }
}

// =============================================================================
// ACL Manager Class
// =============================================================================

/**
 * Base ACL manager class
 */
export abstract class Acl<T extends BucketAccessControl | ObjectAccessControl> {
  protected entries: T[] = []

  /**
   * Get all ACL entries
   */
  async get(): Promise<T[]> {
    return [...this.entries]
  }

  /**
   * Get a specific ACL entry by entity
   */
  async getEntry(entity: string): Promise<T | null> {
    return this.entries.find((e) => e.entity === entity) || null
  }

  /**
   * Add or update an ACL entry
   */
  async add(options: AddAclOptions): Promise<T> {
    const existing = this.entries.findIndex((e) => e.entity === options.entity)

    const entry = {
      entity: options.entity,
      role: options.role,
      id: `${this.getResourceId()}/${options.entity}`,
      selfLink: this.getSelfLink(options.entity),
      etag: crypto.randomUUID(),
    } as T

    if (existing >= 0) {
      this.entries[existing] = entry
    } else {
      this.entries.push(entry)
    }

    await this.persist()
    return entry
  }

  /**
   * Delete an ACL entry
   */
  async delete(entity: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.entity === entity)
    if (index < 0) {
      throw new AclNotFoundError(entity)
    }
    this.entries.splice(index, 1)
    await this.persist()
  }

  /**
   * Update an ACL entry
   */
  async update(entity: string, role: 'OWNER' | 'READER' | 'WRITER'): Promise<T> {
    const existing = this.entries.find((e) => e.entity === entity)
    if (!existing) {
      throw new AclNotFoundError(entity)
    }

    existing.role = role as T['role']
    existing.etag = crypto.randomUUID()

    await this.persist()
    return existing
  }

  /**
   * Check if an entity has a specific role
   */
  hasRole(entity: string, role: 'OWNER' | 'READER' | 'WRITER'): boolean {
    const entry = this.entries.find((e) => e.entity === entity)
    if (!entry) return false

    // OWNER includes WRITER and READER permissions
    if (entry.role === 'OWNER') return true
    // WRITER includes READER permissions
    if (entry.role === 'WRITER' && role === 'READER') return true

    return entry.role === role
  }

  /**
   * Check if public read is enabled
   */
  isPublic(): boolean {
    return this.entries.some(
      (e) => e.entity === 'allUsers' && (e.role === 'READER' || e.role === 'OWNER')
    )
  }

  /**
   * Make public (add allUsers READER)
   */
  async makePublic(): Promise<void> {
    await this.add({ entity: 'allUsers', role: 'READER' })
  }

  /**
   * Make private (remove allUsers and allAuthenticatedUsers)
   */
  async makePrivate(): Promise<void> {
    this.entries = this.entries.filter(
      (e) => e.entity !== 'allUsers' && e.entity !== 'allAuthenticatedUsers'
    )
    await this.persist()
  }

  // Abstract methods to be implemented by subclasses
  protected abstract getResourceId(): string
  protected abstract getSelfLink(entity: string): string
  protected abstract persist(): Promise<void>
}

// =============================================================================
// Bucket ACL
// =============================================================================

/**
 * Bucket ACL manager
 */
export class BucketAcl extends Acl<BucketAccessControl> {
  private bucketName: string
  private backend: StorageBackend
  private projectId?: string

  constructor(bucketName: string, backend: StorageBackend, projectId?: string) {
    super()
    this.bucketName = bucketName
    this.backend = backend
    this.projectId = projectId
  }

  /**
   * Initialize from existing bucket metadata
   */
  async load(): Promise<void> {
    const bucket = await this.backend.getBucket(this.bucketName)
    if (!bucket) {
      throw new BucketNotFoundError(this.bucketName)
    }
    this.entries = bucket.metadata.acl || []
  }

  /**
   * Add owner access for an entity
   */
  async addOwner(entity: string): Promise<BucketAccessControl> {
    return this.add({ entity, role: 'OWNER' })
  }

  /**
   * Add reader access for an entity
   */
  async addReader(entity: string): Promise<BucketAccessControl> {
    return this.add({ entity, role: 'READER' })
  }

  /**
   * Add writer access for an entity
   */
  async addWriter(entity: string): Promise<BucketAccessControl> {
    return this.add({ entity, role: 'WRITER' })
  }

  protected getResourceId(): string {
    return this.bucketName
  }

  protected getSelfLink(entity: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/acl/${encodeURIComponent(entity)}`
  }

  protected async persist(): Promise<void> {
    await this.backend.updateBucketMetadata(this.bucketName, {
      acl: this.entries,
    })
  }
}

/**
 * Default object ACL manager for a bucket
 */
export class DefaultObjectAcl extends Acl<ObjectAccessControl> {
  private bucketName: string
  private backend: StorageBackend

  constructor(bucketName: string, backend: StorageBackend) {
    super()
    this.bucketName = bucketName
    this.backend = backend
  }

  /**
   * Initialize from existing bucket metadata
   */
  async load(): Promise<void> {
    const bucket = await this.backend.getBucket(this.bucketName)
    if (!bucket) {
      throw new BucketNotFoundError(this.bucketName)
    }
    this.entries = bucket.metadata.defaultObjectAcl || []
  }

  protected getResourceId(): string {
    return this.bucketName
  }

  protected getSelfLink(entity: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/defaultObjectAcl/${encodeURIComponent(entity)}`
  }

  protected async persist(): Promise<void> {
    await this.backend.updateBucketMetadata(this.bucketName, {
      defaultObjectAcl: this.entries,
    })
  }
}

// =============================================================================
// File ACL
// =============================================================================

/**
 * File/Object ACL manager
 */
export class FileAcl extends Acl<ObjectAccessControl> {
  private bucketName: string
  private fileName: string
  private backend: StorageBackend

  constructor(bucketName: string, fileName: string, backend: StorageBackend) {
    super()
    this.bucketName = bucketName
    this.fileName = fileName
    this.backend = backend
  }

  /**
   * Initialize from existing file metadata
   */
  async load(): Promise<void> {
    const file = await this.backend.getFile(this.bucketName, this.fileName)
    if (!file) {
      throw new FileNotFoundError(this.bucketName, this.fileName)
    }
    this.entries = file.metadata.acl || []
  }

  /**
   * Add owner access for an entity
   */
  async addOwner(entity: string): Promise<ObjectAccessControl> {
    return this.add({ entity, role: 'OWNER' })
  }

  /**
   * Add reader access for an entity
   */
  async addReader(entity: string): Promise<ObjectAccessControl> {
    return this.add({ entity, role: 'READER' })
  }

  protected getResourceId(): string {
    return `${this.bucketName}/${this.fileName}`
  }

  protected getSelfLink(entity: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${this.bucketName}/o/${encodeURIComponent(this.fileName)}/acl/${encodeURIComponent(entity)}`
  }

  protected async persist(): Promise<void> {
    await this.backend.updateFileMetadata(this.bucketName, this.fileName, {
      acl: this.entries,
    })
  }
}

// =============================================================================
// IAM Manager
// =============================================================================

/**
 * IAM policy manager for buckets
 */
export class BucketIam {
  private bucketName: string
  private backend: StorageBackend
  private policy: Policy = { version: 1, bindings: [] }

  constructor(bucketName: string, backend: StorageBackend) {
    this.bucketName = bucketName
    this.backend = backend
  }

  /**
   * Get the IAM policy
   */
  async getPolicy(options?: { requestedPolicyVersion?: number }): Promise<[Policy]> {
    // In production, this would fetch from the backend
    // For the compat layer, we maintain an in-memory policy
    return [{ ...this.policy }]
  }

  /**
   * Set the IAM policy
   */
  async setPolicy(policy: Policy): Promise<[Policy]> {
    this.policy = {
      ...policy,
      etag: btoa(crypto.randomUUID()),
    }
    return [this.policy]
  }

  /**
   * Test IAM permissions
   */
  async testPermissions(
    permissions: string[],
    options?: TestIamPermissionsOptions
  ): Promise<[string[]]> {
    // In the compat layer, we return all permissions as granted
    // In production, this would check against the actual policy
    return [permissions]
  }

  /**
   * Add a member to a role
   */
  async addMember(role: string, member: string): Promise<void> {
    const binding = this.policy.bindings.find((b) => b.role === role)
    if (binding) {
      if (!binding.members.includes(member)) {
        binding.members.push(member)
      }
    } else {
      this.policy.bindings.push({ role, members: [member] })
    }
  }

  /**
   * Remove a member from a role
   */
  async removeMember(role: string, member: string): Promise<void> {
    const binding = this.policy.bindings.find((b) => b.role === role)
    if (binding) {
      binding.members = binding.members.filter((m) => m !== member)
      // Remove empty bindings
      if (binding.members.length === 0) {
        this.policy.bindings = this.policy.bindings.filter((b) => b.role !== role)
      }
    }
  }

  /**
   * Get members for a role
   */
  getMembersForRole(role: string): string[] {
    const binding = this.policy.bindings.find((b) => b.role === role)
    return binding?.members || []
  }

  /**
   * Check if a member has a role
   */
  hasRole(member: string, role: string): boolean {
    return this.getMembersForRole(role).includes(member)
  }
}

/**
 * Format an IAM member string
 */
export function formatIamMember(
  type: 'user' | 'serviceAccount' | 'group' | 'domain' | 'allUsers' | 'allAuthenticatedUsers',
  identifier?: string
): string {
  switch (type) {
    case 'allUsers':
      return 'allUsers'
    case 'allAuthenticatedUsers':
      return 'allAuthenticatedUsers'
    case 'user':
      return `user:${identifier}`
    case 'serviceAccount':
      return `serviceAccount:${identifier}`
    case 'group':
      return `group:${identifier}`
    case 'domain':
      return `domain:${identifier}`
  }
}

/**
 * Parse an IAM member string
 */
export function parseIamMember(member: string): {
  type: 'user' | 'serviceAccount' | 'group' | 'domain' | 'allUsers' | 'allAuthenticatedUsers'
  identifier?: string
} {
  if (member === 'allUsers') return { type: 'allUsers' }
  if (member === 'allAuthenticatedUsers') return { type: 'allAuthenticatedUsers' }

  const [type, ...rest] = member.split(':')
  const identifier = rest.join(':')

  switch (type) {
    case 'user':
      return { type: 'user', identifier }
    case 'serviceAccount':
      return { type: 'serviceAccount', identifier }
    case 'group':
      return { type: 'group', identifier }
    case 'domain':
      return { type: 'domain', identifier }
    default:
      return { type: 'user', identifier: member }
  }
}
