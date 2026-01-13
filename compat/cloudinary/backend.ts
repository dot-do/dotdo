/**
 * @dotdo/cloudinary/backend - Storage Backend Abstraction
 *
 * Provides pluggable storage backends for the Cloudinary compat layer:
 * - MemoryBackend: In-memory storage for testing
 * - R2Backend: Cloudflare R2 for production
 */

import type {
  InternalAsset,
  InternalFolder,
  InternalDerived,
  ResourceType,
  DeliveryType,
  UploadOptions,
  Transformation,
  ResourceListOptions,
  SearchExpression,
} from './types'

// =============================================================================
// Storage Backend Interface
// =============================================================================

export interface StorageBackend {
  // Asset Operations
  putAsset(asset: InternalAsset): Promise<void>
  getAsset(publicId: string, resourceType?: ResourceType): Promise<InternalAsset | null>
  deleteAsset(publicId: string, resourceType?: ResourceType): Promise<boolean>
  listAssets(options?: AssetListOptions): Promise<AssetListResult>
  assetExists(publicId: string, resourceType?: ResourceType): Promise<boolean>

  // Derived Transformations
  putDerived(derived: InternalDerived): Promise<void>
  getDerived(publicId: string, transformation: string): Promise<InternalDerived | null>
  deleteDerived(publicId: string, transformation?: string): Promise<number>
  listDerived(publicId: string): Promise<InternalDerived[]>

  // Folder Operations
  createFolder(path: string): Promise<InternalFolder>
  deleteFolder(path: string): Promise<string[]>
  listFolders(path?: string): Promise<FolderListResult>
  folderExists(path: string): Promise<boolean>

  // Tag Operations
  addTags(publicId: string, tags: string[], resourceType?: ResourceType): Promise<void>
  removeTags(publicId: string, tags: string[], resourceType?: ResourceType): Promise<void>
  replaceTags(publicId: string, tags: string[], resourceType?: ResourceType): Promise<void>
  listTags(resourceType?: ResourceType, prefix?: string): Promise<string[]>
  getResourcesByTag(tag: string, resourceType?: ResourceType): Promise<string[]>

  // Search
  search(expression: SearchExpression): Promise<SearchResult>

  // Utility
  clear(): void
  generateAssetId(): string
  generateVersionId(): string
}

// =============================================================================
// Backend Types
// =============================================================================

export interface AssetListOptions {
  resourceType?: ResourceType
  type?: DeliveryType
  prefix?: string
  publicIds?: string[]
  maxResults?: number
  nextCursor?: string
  startAt?: Date
  direction?: 'asc' | 'desc'
  includeTags?: boolean
  includeContext?: boolean
}

export interface AssetListResult {
  assets: InternalAsset[]
  nextCursor?: string
  totalCount: number
}

export interface FolderListResult {
  folders: InternalFolder[]
  nextCursor?: string
  totalCount: number
}

export interface SearchResult {
  assets: InternalAsset[]
  totalCount: number
  time: number
  nextCursor?: string
  aggregations?: Record<string, Array<{ value: string; count: number }>>
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(length: number = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function matchesGlob(str: string, pattern: string): boolean {
  // Simple glob matching - supports * wildcard
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
  return regex.test(str)
}

// =============================================================================
// Memory Backend Implementation
// =============================================================================

/**
 * In-memory storage backend for testing
 */
export class MemoryBackend implements StorageBackend {
  private assets: Map<string, InternalAsset> = new Map()
  private derived: Map<string, InternalDerived> = new Map()
  private folders: Map<string, InternalFolder> = new Map()
  private tags: Map<string, Set<string>> = new Map() // tag -> set of public_ids

  // --------------------------------------------------------------------------
  // Asset Operations
  // --------------------------------------------------------------------------

  async putAsset(asset: InternalAsset): Promise<void> {
    const key = this.assetKey(asset.public_id, asset.resource_type)
    this.assets.set(key, asset)

    // Index tags
    for (const tag of asset.tags) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set())
      }
      this.tags.get(tag)!.add(asset.public_id)
    }

    // Ensure folder exists
    if (asset.folder) {
      await this.ensureFolderPath(asset.folder)
    }
  }

  async getAsset(publicId: string, resourceType: ResourceType = 'image'): Promise<InternalAsset | null> {
    const key = this.assetKey(publicId, resourceType)
    return this.assets.get(key) || null
  }

  async deleteAsset(publicId: string, resourceType: ResourceType = 'image'): Promise<boolean> {
    const key = this.assetKey(publicId, resourceType)
    const asset = this.assets.get(key)
    if (!asset) return false

    // Remove from tag index
    for (const tag of asset.tags) {
      this.tags.get(tag)?.delete(publicId)
      if (this.tags.get(tag)?.size === 0) {
        this.tags.delete(tag)
      }
    }

    // Delete derived resources
    await this.deleteDerived(publicId)

    return this.assets.delete(key)
  }

  async listAssets(options: AssetListOptions = {}): Promise<AssetListResult> {
    let assets = Array.from(this.assets.values())

    // Filter by resource type
    if (options.resourceType) {
      assets = assets.filter((a) => a.resource_type === options.resourceType)
    }

    // Filter by delivery type
    if (options.type) {
      assets = assets.filter((a) => a.type === options.type)
    }

    // Filter by prefix (folder path)
    if (options.prefix) {
      assets = assets.filter((a) => a.public_id.startsWith(options.prefix!))
    }

    // Filter by specific public_ids
    if (options.publicIds && options.publicIds.length > 0) {
      const idSet = new Set(options.publicIds)
      assets = assets.filter((a) => idSet.has(a.public_id))
    }

    // Filter by start date
    if (options.startAt) {
      assets = assets.filter((a) => a.created_at >= options.startAt!)
    }

    // Sort
    const direction = options.direction || 'desc'
    assets.sort((a, b) => {
      const diff = a.created_at.getTime() - b.created_at.getTime()
      return direction === 'asc' ? diff : -diff
    })

    const totalCount = assets.length
    const maxResults = options.maxResults || 10

    // Pagination
    let startIndex = 0
    if (options.nextCursor) {
      startIndex = parseInt(options.nextCursor, 10) || 0
    }

    const endIndex = startIndex + maxResults
    const paginatedAssets = assets.slice(startIndex, endIndex)
    const nextCursor = endIndex < totalCount ? endIndex.toString() : undefined

    return {
      assets: paginatedAssets,
      nextCursor,
      totalCount,
    }
  }

  async assetExists(publicId: string, resourceType: ResourceType = 'image'): Promise<boolean> {
    const key = this.assetKey(publicId, resourceType)
    return this.assets.has(key)
  }

  // --------------------------------------------------------------------------
  // Derived Transformations
  // --------------------------------------------------------------------------

  async putDerived(derived: InternalDerived): Promise<void> {
    const key = this.derivedKey(derived.public_id, derived.transformation)
    this.derived.set(key, derived)
  }

  async getDerived(publicId: string, transformation: string): Promise<InternalDerived | null> {
    const key = this.derivedKey(publicId, transformation)
    return this.derived.get(key) || null
  }

  async deleteDerived(publicId: string, transformation?: string): Promise<number> {
    if (transformation) {
      const key = this.derivedKey(publicId, transformation)
      return this.derived.delete(key) ? 1 : 0
    }

    // Delete all derived for this asset
    let count = 0
    const prefix = `${publicId}:`
    for (const key of this.derived.keys()) {
      if (key.startsWith(prefix)) {
        this.derived.delete(key)
        count++
      }
    }
    return count
  }

  async listDerived(publicId: string): Promise<InternalDerived[]> {
    const result: InternalDerived[] = []
    const prefix = `${publicId}:`
    for (const [key, derived] of this.derived) {
      if (key.startsWith(prefix)) {
        result.push(derived)
      }
    }
    return result
  }

  // --------------------------------------------------------------------------
  // Folder Operations
  // --------------------------------------------------------------------------

  async createFolder(path: string): Promise<InternalFolder> {
    const normalizedPath = this.normalizeFolderPath(path)
    if (this.folders.has(normalizedPath)) {
      return this.folders.get(normalizedPath)!
    }

    // Create parent folders recursively
    await this.ensureFolderPath(normalizedPath)

    return this.folders.get(normalizedPath)!
  }

  async deleteFolder(path: string): Promise<string[]> {
    const normalizedPath = this.normalizeFolderPath(path)
    const deleted: string[] = []

    // Delete all subfolders
    for (const folderPath of this.folders.keys()) {
      if (folderPath === normalizedPath || folderPath.startsWith(normalizedPath + '/')) {
        this.folders.delete(folderPath)
        deleted.push(folderPath)
      }
    }

    // Delete all assets in folder and subfolders
    for (const [key, asset] of this.assets) {
      if (asset.folder === normalizedPath || asset.folder.startsWith(normalizedPath + '/')) {
        await this.deleteAsset(asset.public_id, asset.resource_type)
      }
    }

    return deleted
  }

  async listFolders(path?: string): Promise<FolderListResult> {
    const parentPath = path ? this.normalizeFolderPath(path) : ''
    const folders: InternalFolder[] = []
    const seen = new Set<string>()

    for (const folder of this.folders.values()) {
      // Get immediate children of the parent path
      if (parentPath) {
        if (folder.path.startsWith(parentPath + '/')) {
          const remainder = folder.path.slice(parentPath.length + 1)
          const firstSegment = remainder.split('/')[0]
          const childPath = `${parentPath}/${firstSegment}`
          if (!seen.has(childPath)) {
            seen.add(childPath)
            const childFolder = this.folders.get(childPath)
            if (childFolder) folders.push(childFolder)
          }
        }
      } else {
        // Root level folders
        const firstSegment = folder.path.split('/')[0]
        if (!seen.has(firstSegment)) {
          seen.add(firstSegment)
          const rootFolder = this.folders.get(firstSegment)
          if (rootFolder) folders.push(rootFolder)
        }
      }
    }

    return {
      folders,
      totalCount: folders.length,
    }
  }

  async folderExists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizeFolderPath(path)
    return this.folders.has(normalizedPath)
  }

  // --------------------------------------------------------------------------
  // Tag Operations
  // --------------------------------------------------------------------------

  async addTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    for (const tag of tags) {
      if (!asset.tags.includes(tag)) {
        asset.tags.push(tag)
      }
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set())
      }
      this.tags.get(tag)!.add(publicId)
    }
  }

  async removeTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    for (const tag of tags) {
      const index = asset.tags.indexOf(tag)
      if (index >= 0) {
        asset.tags.splice(index, 1)
      }
      this.tags.get(tag)?.delete(publicId)
      if (this.tags.get(tag)?.size === 0) {
        this.tags.delete(tag)
      }
    }
  }

  async replaceTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    // Remove from old tag index
    for (const tag of asset.tags) {
      this.tags.get(tag)?.delete(publicId)
      if (this.tags.get(tag)?.size === 0) {
        this.tags.delete(tag)
      }
    }

    // Set new tags
    asset.tags = [...tags]

    // Add to new tag index
    for (const tag of tags) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set())
      }
      this.tags.get(tag)!.add(publicId)
    }
  }

  async listTags(resourceType?: ResourceType, prefix?: string): Promise<string[]> {
    let tags = Array.from(this.tags.keys())

    if (prefix) {
      tags = tags.filter((t) => t.startsWith(prefix))
    }

    if (resourceType) {
      // Filter tags that have assets of the specified type
      tags = tags.filter((tag) => {
        const publicIds = this.tags.get(tag)!
        for (const publicId of publicIds) {
          const key = this.assetKey(publicId, resourceType)
          if (this.assets.has(key)) return true
        }
        return false
      })
    }

    return tags.sort()
  }

  async getResourcesByTag(tag: string, resourceType?: ResourceType): Promise<string[]> {
    const publicIds = this.tags.get(tag)
    if (!publicIds) return []

    let result = Array.from(publicIds)

    if (resourceType) {
      result = result.filter((publicId) => {
        const key = this.assetKey(publicId, resourceType)
        return this.assets.has(key)
      })
    }

    return result
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  async search(expression: SearchExpression): Promise<SearchResult> {
    const startTime = Date.now()
    let assets = Array.from(this.assets.values())

    // Parse and apply search expression
    assets = this.applySearchExpression(assets, expression.expression)

    // Apply sorting
    if (expression.sort_by && expression.sort_by.length > 0) {
      assets = this.applySorting(assets, expression.sort_by)
    }

    const totalCount = assets.length
    const maxResults = expression.max_results || 50

    // Pagination
    let startIndex = 0
    if (expression.next_cursor) {
      startIndex = parseInt(expression.next_cursor, 10) || 0
    }

    const endIndex = startIndex + maxResults
    const paginatedAssets = assets.slice(startIndex, endIndex)
    const nextCursor = endIndex < totalCount ? endIndex.toString() : undefined

    // Calculate aggregations
    const aggregations = expression.aggregate
      ? this.calculateAggregations(assets, expression.aggregate)
      : undefined

    return {
      assets: paginatedAssets,
      totalCount,
      time: Date.now() - startTime,
      nextCursor,
      aggregations,
    }
  }

  private applySearchExpression(assets: InternalAsset[], expression: string): InternalAsset[] {
    // Parse simple expressions like:
    // - resource_type:image
    // - tags:nature
    // - folder:products/*
    // - bytes>1000
    // - public_id:sample*

    const conditions = expression.split(' AND ')

    for (const condition of conditions) {
      const trimmed = condition.trim()
      if (!trimmed) continue

      // Handle comparison operators
      const gtMatch = trimmed.match(/^(\w+)>(\d+)$/)
      if (gtMatch) {
        const [, field, valueStr] = gtMatch
        const value = parseInt(valueStr, 10)
        assets = assets.filter((a) => {
          const fieldValue = (a as Record<string, unknown>)[field]
          return typeof fieldValue === 'number' && fieldValue > value
        })
        continue
      }

      const ltMatch = trimmed.match(/^(\w+)<(\d+)$/)
      if (ltMatch) {
        const [, field, valueStr] = ltMatch
        const value = parseInt(valueStr, 10)
        assets = assets.filter((a) => {
          const fieldValue = (a as Record<string, unknown>)[field]
          return typeof fieldValue === 'number' && fieldValue < value
        })
        continue
      }

      // Handle equality/pattern matching
      const eqMatch = trimmed.match(/^(\w+):(.+)$/)
      if (eqMatch) {
        const [, field, pattern] = eqMatch
        assets = assets.filter((a) => {
          if (field === 'tags') {
            return a.tags.some((t) => matchesGlob(t, pattern))
          }
          const fieldValue = (a as Record<string, unknown>)[field]
          if (typeof fieldValue === 'string') {
            return matchesGlob(fieldValue, pattern)
          }
          return String(fieldValue) === pattern
        })
      }
    }

    return assets
  }

  private applySorting(
    assets: InternalAsset[],
    sortBy: Array<{ field: string; direction: 'asc' | 'desc' }>
  ): InternalAsset[] {
    return [...assets].sort((a, b) => {
      for (const { field, direction } of sortBy) {
        const aVal = (a as Record<string, unknown>)[field]
        const bVal = (b as Record<string, unknown>)[field]

        let cmp = 0
        if (aVal instanceof Date && bVal instanceof Date) {
          cmp = aVal.getTime() - bVal.getTime()
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else {
          cmp = String(aVal).localeCompare(String(bVal))
        }

        if (cmp !== 0) {
          return direction === 'asc' ? cmp : -cmp
        }
      }
      return 0
    })
  }

  private calculateAggregations(
    assets: InternalAsset[],
    fields: string[]
  ): Record<string, Array<{ value: string; count: number }>> {
    const result: Record<string, Array<{ value: string; count: number }>> = {}

    for (const field of fields) {
      const counts = new Map<string, number>()

      for (const asset of assets) {
        if (field === 'tags') {
          for (const tag of asset.tags) {
            counts.set(tag, (counts.get(tag) || 0) + 1)
          }
        } else {
          const value = String((asset as Record<string, unknown>)[field] || '')
          counts.set(value, (counts.get(value) || 0) + 1)
        }
      }

      result[field] = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
    }

    return result
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  clear(): void {
    this.assets.clear()
    this.derived.clear()
    this.folders.clear()
    this.tags.clear()
  }

  generateAssetId(): string {
    return generateId(24)
  }

  generateVersionId(): string {
    return generateId(32)
  }

  private assetKey(publicId: string, resourceType: ResourceType): string {
    return `${resourceType}:${publicId}`
  }

  private derivedKey(publicId: string, transformation: string): string {
    return `${publicId}:${transformation}`
  }

  private normalizeFolderPath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  }

  private async ensureFolderPath(path: string): Promise<void> {
    const normalizedPath = this.normalizeFolderPath(path)
    if (!normalizedPath) return

    const parts = normalizedPath.split('/')
    let currentPath = ''

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      if (!this.folders.has(currentPath)) {
        this.folders.set(currentPath, {
          name: part,
          path: currentPath,
          external_id: generateId(16),
          created_at: new Date(),
        })
      }
    }
  }
}

// =============================================================================
// R2 Backend Implementation
// =============================================================================

/**
 * Cloudflare R2 storage backend for production
 */
export class R2Backend implements StorageBackend {
  private r2: R2Bucket
  private metadataPrefix = '__cloudinary_meta__/'

  constructor(r2Bucket: R2Bucket) {
    this.r2 = r2Bucket
  }

  private metaKey(type: string, id: string): string {
    return `${this.metadataPrefix}${type}/${id}.json`
  }

  private assetDataKey(publicId: string, resourceType: ResourceType): string {
    return `assets/${resourceType}/${publicId}`
  }

  async putAsset(asset: InternalAsset): Promise<void> {
    // Store data
    const dataKey = this.assetDataKey(asset.public_id, asset.resource_type)
    await this.r2.put(dataKey, asset.data, {
      httpMetadata: { contentType: asset.content_type },
      customMetadata: { public_id: asset.public_id },
    })

    // Store metadata
    const metaKey = this.metaKey('asset', `${asset.resource_type}/${asset.public_id}`)
    const meta = { ...asset, data: undefined } // Don't store data twice
    await this.r2.put(metaKey, JSON.stringify(meta))
  }

  async getAsset(publicId: string, resourceType: ResourceType = 'image'): Promise<InternalAsset | null> {
    const metaKey = this.metaKey('asset', `${resourceType}/${publicId}`)
    const metaObj = await this.r2.get(metaKey)
    if (!metaObj) return null

    const meta = JSON.parse(await metaObj.text()) as InternalAsset
    meta.created_at = new Date(meta.created_at)

    // Get data
    const dataKey = this.assetDataKey(publicId, resourceType)
    const dataObj = await this.r2.get(dataKey)
    if (dataObj) {
      meta.data = new Uint8Array(await dataObj.arrayBuffer())
    }

    return meta
  }

  async deleteAsset(publicId: string, resourceType: ResourceType = 'image'): Promise<boolean> {
    const metaKey = this.metaKey('asset', `${resourceType}/${publicId}`)
    const dataKey = this.assetDataKey(publicId, resourceType)

    const exists = await this.r2.head(metaKey)
    if (!exists) return false

    await this.r2.delete([metaKey, dataKey])
    await this.deleteDerived(publicId)
    return true
  }

  async listAssets(options: AssetListOptions = {}): Promise<AssetListResult> {
    const prefix = `${this.metadataPrefix}asset/`
    const listed = await this.r2.list({
      prefix: options.resourceType ? `${prefix}${options.resourceType}/` : prefix,
      limit: options.maxResults || 10,
      cursor: options.nextCursor,
    })

    const assets: InternalAsset[] = []
    for (const obj of listed.objects) {
      const metaObj = await this.r2.get(obj.key)
      if (metaObj) {
        const meta = JSON.parse(await metaObj.text()) as InternalAsset
        meta.created_at = new Date(meta.created_at)
        assets.push(meta)
      }
    }

    return {
      assets,
      nextCursor: listed.truncated ? listed.cursor : undefined,
      totalCount: assets.length,
    }
  }

  async assetExists(publicId: string, resourceType: ResourceType = 'image'): Promise<boolean> {
    const metaKey = this.metaKey('asset', `${resourceType}/${publicId}`)
    return (await this.r2.head(metaKey)) !== null
  }

  async putDerived(derived: InternalDerived): Promise<void> {
    const key = `derived/${derived.public_id}/${encodeURIComponent(derived.transformation)}`
    await this.r2.put(key, derived.data, {
      customMetadata: {
        public_id: derived.public_id,
        transformation: derived.transformation,
        format: derived.format,
      },
    })
  }

  async getDerived(publicId: string, transformation: string): Promise<InternalDerived | null> {
    const key = `derived/${publicId}/${encodeURIComponent(transformation)}`
    const obj = await this.r2.get(key)
    if (!obj) return null

    return {
      id: generateId(16),
      public_id: publicId,
      transformation: obj.customMetadata?.transformation || transformation,
      format: obj.customMetadata?.format || '',
      bytes: obj.size,
      data: new Uint8Array(await obj.arrayBuffer()),
      created_at: obj.uploaded,
    }
  }

  async deleteDerived(publicId: string, transformation?: string): Promise<number> {
    if (transformation) {
      const key = `derived/${publicId}/${encodeURIComponent(transformation)}`
      const exists = await this.r2.head(key)
      if (exists) {
        await this.r2.delete(key)
        return 1
      }
      return 0
    }

    // Delete all derived
    const prefix = `derived/${publicId}/`
    const listed = await this.r2.list({ prefix })
    if (listed.objects.length > 0) {
      await this.r2.delete(listed.objects.map((o) => o.key))
    }
    return listed.objects.length
  }

  async listDerived(publicId: string): Promise<InternalDerived[]> {
    const prefix = `derived/${publicId}/`
    const listed = await this.r2.list({ prefix })
    const result: InternalDerived[] = []

    for (const obj of listed.objects) {
      const fullObj = await this.r2.get(obj.key)
      if (fullObj) {
        result.push({
          id: generateId(16),
          public_id: publicId,
          transformation: decodeURIComponent(obj.key.split('/').pop() || ''),
          format: fullObj.customMetadata?.format || '',
          bytes: fullObj.size,
          data: new Uint8Array(await fullObj.arrayBuffer()),
          created_at: fullObj.uploaded,
        })
      }
    }

    return result
  }

  async createFolder(path: string): Promise<InternalFolder> {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    const parts = normalizedPath.split('/')
    const name = parts[parts.length - 1]

    const folder: InternalFolder = {
      name,
      path: normalizedPath,
      external_id: generateId(16),
      created_at: new Date(),
    }

    const key = this.metaKey('folder', normalizedPath)
    await this.r2.put(key, JSON.stringify(folder))

    return folder
  }

  async deleteFolder(path: string): Promise<string[]> {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    const deleted: string[] = []

    // List and delete folder metadata
    const folderPrefix = `${this.metadataPrefix}folder/${normalizedPath}`
    const folders = await this.r2.list({ prefix: folderPrefix })
    for (const obj of folders.objects) {
      await this.r2.delete(obj.key)
      deleted.push(obj.key)
    }

    // List and delete assets in folder
    const assetPrefix = `${this.metadataPrefix}asset/`
    const assets = await this.r2.list({ prefix: assetPrefix })
    for (const obj of assets.objects) {
      const metaObj = await this.r2.get(obj.key)
      if (metaObj) {
        const meta = JSON.parse(await metaObj.text()) as InternalAsset
        if (meta.folder === normalizedPath || meta.folder.startsWith(normalizedPath + '/')) {
          await this.deleteAsset(meta.public_id, meta.resource_type)
        }
      }
    }

    return deleted
  }

  async listFolders(path?: string): Promise<FolderListResult> {
    const prefix = path
      ? `${this.metadataPrefix}folder/${path}/`
      : `${this.metadataPrefix}folder/`

    const listed = await this.r2.list({ prefix })
    const folders: InternalFolder[] = []

    for (const obj of listed.objects) {
      const fullObj = await this.r2.get(obj.key)
      if (fullObj) {
        const folder = JSON.parse(await fullObj.text()) as InternalFolder
        folder.created_at = new Date(folder.created_at)
        folders.push(folder)
      }
    }

    return {
      folders,
      totalCount: folders.length,
    }
  }

  async folderExists(path: string): Promise<boolean> {
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    const key = this.metaKey('folder', normalizedPath)
    return (await this.r2.head(key)) !== null
  }

  async addTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    for (const tag of tags) {
      if (!asset.tags.includes(tag)) {
        asset.tags.push(tag)
      }
    }

    await this.putAsset(asset)
  }

  async removeTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    asset.tags = asset.tags.filter((t) => !tags.includes(t))
    await this.putAsset(asset)
  }

  async replaceTags(publicId: string, tags: string[], resourceType: ResourceType = 'image'): Promise<void> {
    const asset = await this.getAsset(publicId, resourceType)
    if (!asset) return

    asset.tags = [...tags]
    await this.putAsset(asset)
  }

  async listTags(resourceType?: ResourceType, prefix?: string): Promise<string[]> {
    const assets = await this.listAssets({ resourceType })
    const tagSet = new Set<string>()

    for (const asset of assets.assets) {
      for (const tag of asset.tags) {
        if (!prefix || tag.startsWith(prefix)) {
          tagSet.add(tag)
        }
      }
    }

    return Array.from(tagSet).sort()
  }

  async getResourcesByTag(tag: string, resourceType?: ResourceType): Promise<string[]> {
    const assets = await this.listAssets({ resourceType })
    return assets.assets.filter((a) => a.tags.includes(tag)).map((a) => a.public_id)
  }

  async search(expression: SearchExpression): Promise<SearchResult> {
    // For R2, we need to load all assets and filter in memory
    // In production, this would use a search index
    const startTime = Date.now()
    const allAssets = await this.listAssets({ maxResults: 1000 })

    // Use memory backend's search logic
    const memBackend = new MemoryBackend()
    for (const asset of allAssets.assets) {
      await memBackend.putAsset(asset)
    }

    return memBackend.search(expression)
  }

  clear(): void {
    // R2 doesn't support clear - would need to list and delete all
    console.warn('R2Backend.clear() is not fully implemented')
  }

  generateAssetId(): string {
    return generateId(24)
  }

  generateVersionId(): string {
    return generateId(32)
  }
}

// =============================================================================
// Default Instance
// =============================================================================

export const defaultMemoryBackend = new MemoryBackend()
