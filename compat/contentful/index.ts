/**
 * @dotdo/contentful - Contentful SDK Compat Layer
 *
 * API-compatible implementation of contentful-management SDK
 * backed by in-memory storage (DO SQLite in production)
 *
 * @see https://www.contentful.com/developers/docs/references/content-management-api/
 * @see https://contentful.github.io/contentful-management.js/
 */

// =============================================================================
// Types
// =============================================================================

export interface ContentfulClientConfig {
  accessToken: string
  host?: string
  spaceId?: string
}

export interface ContentfulClient {
  getSpace(spaceId: string): Promise<Space>
}

export interface Space {
  sys: {
    id: string
    type: 'Space'
  }
  name: string
  getEnvironment(environmentId: string): Promise<Environment>
  getEnvironments(): Promise<EnvironmentCollection>
  createEnvironment(props: CreateEnvironmentProps): Promise<Environment>
  getContentTypes(): Promise<ContentTypeCollection>
  getLocales(): Promise<LocaleCollection>
}

export interface CreateEnvironmentProps {
  name: string
}

export interface EnvironmentCollection {
  items: Environment[]
  total: number
}

export interface Environment {
  sys: {
    id: string
    type: 'Environment'
  }
  name: string
  // Assets
  createAsset(props: CreateAssetProps): Promise<Asset>
  createAssetWithId(id: string, props: CreateAssetProps): Promise<Asset>
  createUpload(props: CreateUploadProps): Promise<Upload>
  getAsset(id: string, query?: AssetQuery): Promise<Asset>
  getAssets(query?: AssetsQuery): Promise<AssetCollection>
  getPublishedAssets(query?: AssetsQuery): Promise<AssetCollection>
  // Entries
  createEntry(contentTypeId: string, props: CreateEntryProps): Promise<Entry>
  createEntryWithId(contentTypeId: string, id: string, props: CreateEntryProps): Promise<Entry>
  getEntry(id: string, query?: EntryQuery): Promise<Entry>
  getEntries(query?: EntriesQuery): Promise<EntryCollection>
  getPublishedEntries(query?: EntriesQuery): Promise<EntryCollection>
  // Content Types
  createContentType(props: CreateContentTypeProps): Promise<ContentType>
  createContentTypeWithId(id: string, props: CreateContentTypeProps): Promise<ContentType>
  getContentType(id: string): Promise<ContentType>
  getContentTypes(query?: ContentTypesQuery): Promise<ContentTypeCollection>
  // Locales
  createLocale(props: CreateLocaleProps): Promise<Locale>
  getLocale(id: string): Promise<Locale>
  getLocales(): Promise<LocaleCollection>
  // Tags
  createTag(id: string, name: string, visibility?: 'public' | 'private'): Promise<Tag>
  getTag(id: string): Promise<Tag>
  getTags(): Promise<TagCollection>
}

// =============================================================================
// Asset Types
// =============================================================================

export interface CreateAssetProps {
  fields: {
    title: Record<string, string>
    description?: Record<string, string>
    file: Record<string, AssetFileProp>
  }
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface AssetFileProp {
  contentType: string
  fileName: string
  upload?: string
  uploadFrom?: {
    sys: {
      type: 'Link'
      linkType: 'Upload'
      id: string
    }
  }
  url?: string
  details?: {
    size: number
    image?: {
      width: number
      height: number
    }
  }
}

export interface CreateUploadProps {
  file: Uint8Array | Blob | ArrayBuffer
}

export interface Upload {
  sys: {
    id: string
    type: 'Upload'
    expiresAt: string
  }
}

export interface Asset {
  sys: AssetSys
  fields: AssetFields
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
  processForLocale(locale: string): Promise<Asset>
  processForAllLocales(options?: ProcessOptions): Promise<Asset>
  publish(): Promise<Asset>
  unpublish(): Promise<Asset>
  archive(): Promise<Asset>
  unarchive(): Promise<Asset>
  delete(): Promise<void>
  update(): Promise<Asset>
  isPublished(): boolean
  isDraft(): boolean
  isUpdated(): boolean
  isArchived(): boolean
  toPlainObject(): AssetProps
}

export interface AssetSys {
  id: string
  type: 'Asset'
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  publishedVersion?: number
  archivedAt?: string
  space: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Space'
    }
  }
  environment: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Environment'
    }
  }
}

export interface AssetFields {
  title: Record<string, string>
  description?: Record<string, string>
  file: Record<string, AssetFileProp>
}

export interface AssetProps {
  sys: AssetSys
  fields: AssetFields
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface ProcessOptions {
  processingCheckWait?: number
  processingCheckRetries?: number
}

export interface AssetCollection {
  items: Asset[]
  total: number
  skip: number
  limit: number
}

export interface AssetQuery {
  locale?: string
}

export interface AssetsQuery {
  [key: string]: string | number | boolean | undefined
  limit?: number
  skip?: number
  order?: string
  select?: string
  mimetype_group?: string
}

// =============================================================================
// Entry Types
// =============================================================================

export interface CreateEntryProps {
  fields: Record<string, Record<string, unknown>>
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface Entry {
  sys: EntrySys
  fields: Record<string, Record<string, unknown>>
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
  publish(): Promise<Entry>
  unpublish(): Promise<Entry>
  archive(): Promise<Entry>
  unarchive(): Promise<Entry>
  delete(): Promise<void>
  update(): Promise<Entry>
  isPublished(): boolean
  isDraft(): boolean
  isUpdated(): boolean
  isArchived(): boolean
  toPlainObject(): EntryProps
}

export interface EntrySys {
  id: string
  type: 'Entry'
  contentType: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'ContentType'
    }
  }
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  publishedVersion?: number
  archivedAt?: string
  space: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Space'
    }
  }
  environment: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Environment'
    }
  }
}

export interface EntryProps {
  sys: EntrySys
  fields: Record<string, Record<string, unknown>>
  metadata?: {
    tags?: Array<{ sys: { type: 'Link'; linkType: 'Tag'; id: string } }>
  }
}

export interface EntryCollection {
  items: Entry[]
  total: number
  skip: number
  limit: number
}

export interface EntryQuery {
  locale?: string
}

export interface EntriesQuery {
  [key: string]: string | number | boolean | undefined
  content_type?: string
  limit?: number
  skip?: number
  order?: string
  select?: string
}

// =============================================================================
// Content Type Types
// =============================================================================

export interface CreateContentTypeProps {
  name: string
  description?: string
  displayField?: string
  fields: ContentTypeField[]
}

export interface ContentTypeField {
  id: string
  name: string
  type: 'Symbol' | 'Text' | 'Integer' | 'Number' | 'Date' | 'Boolean' | 'Location' | 'Link' | 'Array' | 'Object' | 'RichText'
  required?: boolean
  localized?: boolean
  disabled?: boolean
  omitted?: boolean
  validations?: FieldValidation[]
  linkType?: 'Asset' | 'Entry'
  items?: {
    type: 'Symbol' | 'Link'
    linkType?: 'Asset' | 'Entry'
    validations?: FieldValidation[]
  }
}

export interface FieldValidation {
  unique?: boolean
  size?: { min?: number; max?: number }
  range?: { min?: number; max?: number }
  regexp?: { pattern: string; flags?: string }
  in?: unknown[]
  linkContentType?: string[]
  linkMimetypeGroup?: string[]
  enabledNodeTypes?: string[]
  enabledMarks?: string[]
  message?: string
}

export interface ContentType {
  sys: ContentTypeSys
  name: string
  description?: string
  displayField?: string
  fields: ContentTypeField[]
  publish(): Promise<ContentType>
  unpublish(): Promise<ContentType>
  delete(): Promise<void>
  update(): Promise<ContentType>
  isPublished(): boolean
  toPlainObject(): ContentTypeProps
}

export interface ContentTypeSys {
  id: string
  type: 'ContentType'
  version: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
  publishedVersion?: number
  space: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Space'
    }
  }
  environment: {
    sys: {
      id: string
      type: 'Link'
      linkType: 'Environment'
    }
  }
}

export interface ContentTypeProps {
  sys: ContentTypeSys
  name: string
  description?: string
  displayField?: string
  fields: ContentTypeField[]
}

export interface ContentTypeCollection {
  items: ContentType[]
  total: number
  skip: number
  limit: number
}

export interface ContentTypesQuery {
  limit?: number
  skip?: number
  order?: string
}

// =============================================================================
// Locale Types
// =============================================================================

export interface CreateLocaleProps {
  name: string
  code: string
  fallbackCode?: string | null
  default?: boolean
  contentManagementApi?: boolean
  contentDeliveryApi?: boolean
  optional?: boolean
}

export interface Locale {
  sys: {
    id: string
    type: 'Locale'
    version: number
  }
  name: string
  code: string
  fallbackCode?: string | null
  default: boolean
  contentManagementApi: boolean
  contentDeliveryApi: boolean
  optional: boolean
  update(): Promise<Locale>
  delete(): Promise<void>
}

export interface LocaleCollection {
  items: Locale[]
  total: number
}

// =============================================================================
// Tag Types
// =============================================================================

export interface Tag {
  sys: {
    id: string
    type: 'Tag'
    version: number
    visibility: 'public' | 'private'
    createdAt: string
    updatedAt: string
  }
  name: string
  update(): Promise<Tag>
  delete(): Promise<void>
}

export interface TagCollection {
  items: Tag[]
  total: number
}

// =============================================================================
// Image Transform Types
// =============================================================================

export interface ImageTransformOptions {
  width?: number
  height?: number
  fit?: 'pad' | 'fill' | 'scale' | 'crop' | 'thumb'
  focus?: 'center' | 'top' | 'right' | 'left' | 'bottom' | 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left' | 'face' | 'faces'
  format?: 'jpg' | 'png' | 'webp' | 'gif' | 'avif'
  quality?: number
  radius?: number | 'max'
  backgroundColor?: string
  progressive?: boolean
  png8?: boolean
}

// =============================================================================
// Error Classes
// =============================================================================

export class ContentfulError extends Error {
  public sys?: { type: string; id: string }

  constructor(message: string) {
    super(message)
    this.name = 'ContentfulError'
  }
}

export class NotFoundError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class AccessDeniedError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDeniedError'
  }
}

export class RateLimitError extends ContentfulError {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// =============================================================================
// In-Memory Storage
// =============================================================================

interface SpaceStorage {
  id: string
  name: string
  environments: Map<string, EnvironmentStorage>
  locales: Map<string, LocaleData>
}

interface EnvironmentStorage {
  id: string
  name: string
  assets: Map<string, AssetData>
  entries: Map<string, EntryData>
  contentTypes: Map<string, ContentTypeData>
  uploads: Map<string, UploadData>
  tags: Map<string, TagData>
}

interface AssetData {
  sys: AssetSys
  fields: AssetFields
  metadata?: AssetProps['metadata']
}

interface EntryData {
  sys: EntrySys
  fields: Record<string, Record<string, unknown>>
  metadata?: EntryProps['metadata']
}

interface ContentTypeData {
  sys: ContentTypeSys
  name: string
  description?: string
  displayField?: string
  fields: ContentTypeField[]
}

interface UploadData {
  id: string
  expiresAt: string
  data: Uint8Array
}

interface TagData {
  id: string
  name: string
  visibility: 'public' | 'private'
  createdAt: string
  updatedAt: string
  version: number
}

interface LocaleData {
  id: string
  name: string
  code: string
  fallbackCode?: string | null
  default: boolean
  contentManagementApi: boolean
  contentDeliveryApi: boolean
  optional: boolean
  version: number
}

const globalStorage = new Map<string, SpaceStorage>()

function getSpaceStorage(spaceId: string): SpaceStorage {
  let space = globalStorage.get(spaceId)
  if (!space) {
    space = {
      id: spaceId,
      name: `Space ${spaceId}`,
      environments: new Map(),
      locales: new Map(),
    }
    // Add default locale
    space.locales.set('en-US', {
      id: 'en-US',
      name: 'English (US)',
      code: 'en-US',
      fallbackCode: null,
      default: true,
      contentManagementApi: true,
      contentDeliveryApi: true,
      optional: false,
      version: 1,
    })
    globalStorage.set(spaceId, space)
  }
  return space
}

function getEnvironmentStorage(spaceId: string, envId: string): EnvironmentStorage {
  const space = getSpaceStorage(spaceId)
  let env = space.environments.get(envId)
  if (!env) {
    env = {
      id: envId,
      name: envId === 'master' ? 'master' : `Environment ${envId}`,
      assets: new Map(),
      entries: new Map(),
      contentTypes: new Map(),
      uploads: new Map(),
      tags: new Map(),
    }
    space.environments.set(envId, env)
  }
  return env
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

// =============================================================================
// Asset Implementation
// =============================================================================

function createAssetObject(spaceId: string, envId: string, data: AssetData): Asset {
  const asset: Asset = {
    sys: { ...data.sys },
    fields: JSON.parse(JSON.stringify(data.fields)),
    metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,

    async processForLocale(locale: string): Promise<Asset> {
      const space = getSpaceStorage(spaceId)
      if (!space.locales.has(locale) && !data.fields.file[locale]) {
        throw new ValidationError(`Invalid locale: ${locale}`)
      }

      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      // Simulate processing - convert upload URL to CDN URL
      if (stored.fields.file[locale]) {
        const file = stored.fields.file[locale]
        if (file.upload || file.uploadFrom) {
          file.url = `https://images.ctfassets.net/${spaceId}/${data.sys.id}/${file.fileName}`
          delete file.upload
          delete file.uploadFrom
          file.details = {
            size: 12345,
            image: file.contentType.startsWith('image/') ? { width: 800, height: 600 } : undefined,
          }
        }
      }

      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async processForAllLocales(_options?: ProcessOptions): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      for (const locale of Object.keys(stored.fields.file)) {
        const file = stored.fields.file[locale]
        if (file.upload || file.uploadFrom) {
          file.url = `https://images.ctfassets.net/${spaceId}/${data.sys.id}/${file.fileName}`
          delete file.upload
          delete file.uploadFrom
          file.details = {
            size: 12345,
            image: file.contentType.startsWith('image/') ? { width: 800, height: 600 } : undefined,
          }
        }
      }

      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async publish(): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      stored.sys.publishedAt = new Date().toISOString()
      stored.sys.publishedVersion = stored.sys.version
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async unpublish(): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      delete stored.sys.publishedAt
      delete stored.sys.publishedVersion
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async archive(): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      stored.sys.archivedAt = new Date().toISOString()
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async unarchive(): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      delete stored.sys.archivedAt
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    async delete(): Promise<void> {
      const env = getEnvironmentStorage(spaceId, envId)
      if (!env.assets.has(data.sys.id)) {
        throw new NotFoundError(`Asset ${data.sys.id} not found`)
      }
      env.assets.delete(data.sys.id)
    },

    async update(): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.assets.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Asset ${data.sys.id} not found`)

      stored.fields = JSON.parse(JSON.stringify(this.fields))
      stored.metadata = this.metadata ? JSON.parse(JSON.stringify(this.metadata)) : undefined
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createAssetObject(spaceId, envId, stored)
    },

    isPublished(): boolean {
      return data.sys.publishedAt !== undefined
    },

    isDraft(): boolean {
      return data.sys.publishedAt === undefined
    },

    isUpdated(): boolean {
      return data.sys.publishedVersion !== undefined && data.sys.publishedVersion < data.sys.version
    },

    isArchived(): boolean {
      return data.sys.archivedAt !== undefined
    },

    toPlainObject(): AssetProps {
      return {
        sys: { ...data.sys },
        fields: JSON.parse(JSON.stringify(data.fields)),
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      }
    },
  }

  return asset
}

// =============================================================================
// Entry Implementation
// =============================================================================

function createEntryObject(spaceId: string, envId: string, data: EntryData): Entry {
  const entry: Entry = {
    sys: { ...data.sys },
    fields: JSON.parse(JSON.stringify(data.fields)),
    metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,

    async publish(): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.entries.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Entry ${data.sys.id} not found`)

      stored.sys.publishedAt = new Date().toISOString()
      stored.sys.publishedVersion = stored.sys.version
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createEntryObject(spaceId, envId, stored)
    },

    async unpublish(): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.entries.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Entry ${data.sys.id} not found`)

      delete stored.sys.publishedAt
      delete stored.sys.publishedVersion
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createEntryObject(spaceId, envId, stored)
    },

    async archive(): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.entries.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Entry ${data.sys.id} not found`)

      stored.sys.archivedAt = new Date().toISOString()
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createEntryObject(spaceId, envId, stored)
    },

    async unarchive(): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.entries.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Entry ${data.sys.id} not found`)

      delete stored.sys.archivedAt
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createEntryObject(spaceId, envId, stored)
    },

    async delete(): Promise<void> {
      const env = getEnvironmentStorage(spaceId, envId)
      if (!env.entries.has(data.sys.id)) {
        throw new NotFoundError(`Entry ${data.sys.id} not found`)
      }
      env.entries.delete(data.sys.id)
    },

    async update(): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.entries.get(data.sys.id)
      if (!stored) throw new NotFoundError(`Entry ${data.sys.id} not found`)

      stored.fields = JSON.parse(JSON.stringify(this.fields))
      stored.metadata = this.metadata ? JSON.parse(JSON.stringify(this.metadata)) : undefined
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createEntryObject(spaceId, envId, stored)
    },

    isPublished(): boolean {
      return data.sys.publishedAt !== undefined
    },

    isDraft(): boolean {
      return data.sys.publishedAt === undefined
    },

    isUpdated(): boolean {
      return data.sys.publishedVersion !== undefined && data.sys.publishedVersion < data.sys.version
    },

    isArchived(): boolean {
      return data.sys.archivedAt !== undefined
    },

    toPlainObject(): EntryProps {
      return {
        sys: { ...data.sys },
        fields: JSON.parse(JSON.stringify(data.fields)),
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      }
    },
  }

  return entry
}

// =============================================================================
// ContentType Implementation
// =============================================================================

function createContentTypeObject(spaceId: string, envId: string, data: ContentTypeData): ContentType {
  const contentType: ContentType = {
    sys: { ...data.sys },
    name: data.name,
    description: data.description,
    displayField: data.displayField,
    fields: JSON.parse(JSON.stringify(data.fields)),

    async publish(): Promise<ContentType> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.contentTypes.get(data.sys.id)
      if (!stored) throw new NotFoundError(`ContentType ${data.sys.id} not found`)

      stored.sys.publishedAt = new Date().toISOString()
      stored.sys.publishedVersion = stored.sys.version
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createContentTypeObject(spaceId, envId, stored)
    },

    async unpublish(): Promise<ContentType> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.contentTypes.get(data.sys.id)
      if (!stored) throw new NotFoundError(`ContentType ${data.sys.id} not found`)

      delete stored.sys.publishedAt
      delete stored.sys.publishedVersion
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createContentTypeObject(spaceId, envId, stored)
    },

    async delete(): Promise<void> {
      const env = getEnvironmentStorage(spaceId, envId)
      if (!env.contentTypes.has(data.sys.id)) {
        throw new NotFoundError(`ContentType ${data.sys.id} not found`)
      }
      env.contentTypes.delete(data.sys.id)
    },

    async update(): Promise<ContentType> {
      const env = getEnvironmentStorage(spaceId, envId)
      const stored = env.contentTypes.get(data.sys.id)
      if (!stored) throw new NotFoundError(`ContentType ${data.sys.id} not found`)

      stored.name = this.name
      stored.description = this.description
      stored.displayField = this.displayField
      stored.fields = JSON.parse(JSON.stringify(this.fields))
      stored.sys.updatedAt = new Date().toISOString()
      stored.sys.version++

      return createContentTypeObject(spaceId, envId, stored)
    },

    isPublished(): boolean {
      return data.sys.publishedAt !== undefined
    },

    toPlainObject(): ContentTypeProps {
      return {
        sys: { ...data.sys },
        name: data.name,
        description: data.description,
        displayField: data.displayField,
        fields: JSON.parse(JSON.stringify(data.fields)),
      }
    },
  }

  return contentType
}

// =============================================================================
// Environment Implementation
// =============================================================================

function createEnvironmentObject(spaceId: string, envId: string): Environment {
  const envStorage = getEnvironmentStorage(spaceId, envId)

  return {
    sys: {
      id: envId,
      type: 'Environment',
    },
    name: envStorage.name,

    // Assets
    async createAsset(props: CreateAssetProps): Promise<Asset> {
      const id = generateId()
      return this.createAssetWithId(id, props)
    },

    async createAssetWithId(id: string, props: CreateAssetProps): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const now = new Date().toISOString()

      const data: AssetData = {
        sys: {
          id,
          type: 'Asset',
          version: 1,
          createdAt: now,
          updatedAt: now,
          space: { sys: { id: spaceId, type: 'Link', linkType: 'Space' } },
          environment: { sys: { id: envId, type: 'Link', linkType: 'Environment' } },
        },
        fields: JSON.parse(JSON.stringify(props.fields)),
        metadata: props.metadata ? JSON.parse(JSON.stringify(props.metadata)) : undefined,
      }

      env.assets.set(id, data)
      return createAssetObject(spaceId, envId, data)
    },

    async createUpload(props: CreateUploadProps): Promise<Upload> {
      const env = getEnvironmentStorage(spaceId, envId)
      const id = generateId()

      // Check file size (max 1000MB)
      let fileSize = 0
      if (props.file instanceof Uint8Array) {
        fileSize = props.file.length
      } else if (props.file instanceof Blob) {
        fileSize = props.file.size
      } else if (props.file instanceof ArrayBuffer) {
        fileSize = props.file.byteLength
      }

      if (fileSize > 1000 * 1024 * 1024) {
        throw new ValidationError('File size exceeds maximum allowed (1000MB)')
      }

      // Convert to Uint8Array
      let data: Uint8Array
      if (props.file instanceof Uint8Array) {
        data = props.file
      } else if (props.file instanceof Blob) {
        const buffer = await props.file.arrayBuffer()
        data = new Uint8Array(buffer)
      } else {
        data = new Uint8Array(props.file)
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      env.uploads.set(id, { id, expiresAt, data })

      return {
        sys: {
          id,
          type: 'Upload',
          expiresAt,
        },
      }
    },

    async getAsset(id: string, _query?: AssetQuery): Promise<Asset> {
      const env = getEnvironmentStorage(spaceId, envId)
      const data = env.assets.get(id)
      if (!data) throw new NotFoundError(`Asset ${id} not found`)
      return createAssetObject(spaceId, envId, data)
    },

    async getAssets(query?: AssetsQuery): Promise<AssetCollection> {
      const env = getEnvironmentStorage(spaceId, envId)
      let items = Array.from(env.assets.values())

      // Apply filters
      if (query) {
        // Content type filter
        if (query['fields.file.contentType']) {
          items = items.filter((a) => {
            const locales = Object.keys(a.fields.file)
            return locales.some((l) => a.fields.file[l].contentType === query['fields.file.contentType'])
          })
        }

        // Title match filter
        const titleMatch = query['fields.title[match]'] as string | undefined
        if (titleMatch) {
          items = items.filter((a) => {
            const locales = Object.keys(a.fields.title)
            return locales.some((l) => a.fields.title[l].includes(titleMatch))
          })
        }

        // Published exists filter
        if (query['sys.publishedAt[exists]'] === true) {
          items = items.filter((a) => a.sys.publishedAt !== undefined)
        }

        // Mimetype group filter
        if (query.mimetype_group) {
          const group = query.mimetype_group as string
          items = items.filter((a) => {
            const locales = Object.keys(a.fields.file)
            return locales.some((l) => a.fields.file[l].contentType.startsWith(`${group}/`))
          })
        }

        // Order
        if (query.order) {
          const desc = query.order.startsWith('-')
          const field = desc ? query.order.slice(1) : query.order
          items.sort((a, b) => {
            let aVal: string, bVal: string
            if (field === 'fields.title') {
              const aLocales = Object.keys(a.fields.title)
              const bLocales = Object.keys(b.fields.title)
              aVal = a.fields.title[aLocales[0]] || ''
              bVal = b.fields.title[bLocales[0]] || ''
            } else if (field === 'sys.createdAt') {
              aVal = a.sys.createdAt
              bVal = b.sys.createdAt
            } else {
              aVal = ''
              bVal = ''
            }
            const cmp = aVal.localeCompare(bVal)
            return desc ? -cmp : cmp
          })
        }
      }

      const total = items.length
      const skip = query?.skip || 0
      const limit = query?.limit || 100

      items = items.slice(skip, skip + limit)

      return {
        items: items.map((d) => createAssetObject(spaceId, envId, d)),
        total,
        skip,
        limit,
      }
    },

    async getPublishedAssets(query?: AssetsQuery): Promise<AssetCollection> {
      const result = await this.getAssets(query)
      const publishedItems = result.items.filter((a) => a.isPublished())
      return {
        items: publishedItems,
        total: publishedItems.length,
        skip: result.skip,
        limit: result.limit,
      }
    },

    // Entries
    async createEntry(contentTypeId: string, props: CreateEntryProps): Promise<Entry> {
      const id = generateId()
      return this.createEntryWithId(contentTypeId, id, props)
    },

    async createEntryWithId(contentTypeId: string, id: string, props: CreateEntryProps): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const now = new Date().toISOString()

      const data: EntryData = {
        sys: {
          id,
          type: 'Entry',
          contentType: { sys: { id: contentTypeId, type: 'Link', linkType: 'ContentType' } },
          version: 1,
          createdAt: now,
          updatedAt: now,
          space: { sys: { id: spaceId, type: 'Link', linkType: 'Space' } },
          environment: { sys: { id: envId, type: 'Link', linkType: 'Environment' } },
        },
        fields: JSON.parse(JSON.stringify(props.fields)),
        metadata: props.metadata ? JSON.parse(JSON.stringify(props.metadata)) : undefined,
      }

      env.entries.set(id, data)
      return createEntryObject(spaceId, envId, data)
    },

    async getEntry(id: string, _query?: EntryQuery): Promise<Entry> {
      const env = getEnvironmentStorage(spaceId, envId)
      const data = env.entries.get(id)
      if (!data) throw new NotFoundError(`Entry ${id} not found`)
      return createEntryObject(spaceId, envId, data)
    },

    async getEntries(query?: EntriesQuery): Promise<EntryCollection> {
      const env = getEnvironmentStorage(spaceId, envId)
      let items = Array.from(env.entries.values())

      // Apply filters
      if (query?.content_type) {
        items = items.filter((e) => e.sys.contentType.sys.id === query.content_type)
      }

      // Order
      if (query?.order) {
        const desc = query.order.startsWith('-')
        const field = desc ? query.order.slice(1) : query.order
        items.sort((a, b) => {
          let aVal: string, bVal: string
          if (field === 'sys.createdAt') {
            aVal = a.sys.createdAt
            bVal = b.sys.createdAt
          } else if (field === 'sys.updatedAt') {
            aVal = a.sys.updatedAt
            bVal = b.sys.updatedAt
          } else {
            aVal = ''
            bVal = ''
          }
          const cmp = aVal.localeCompare(bVal)
          return desc ? -cmp : cmp
        })
      }

      const total = items.length
      const skip = query?.skip || 0
      const limit = query?.limit || 100

      items = items.slice(skip, skip + limit)

      return {
        items: items.map((d) => createEntryObject(spaceId, envId, d)),
        total,
        skip,
        limit,
      }
    },

    async getPublishedEntries(query?: EntriesQuery): Promise<EntryCollection> {
      const result = await this.getEntries(query)
      const publishedItems = result.items.filter((e) => e.isPublished())
      return {
        items: publishedItems,
        total: publishedItems.length,
        skip: result.skip,
        limit: result.limit,
      }
    },

    // Content Types
    async createContentType(props: CreateContentTypeProps): Promise<ContentType> {
      const id = generateId()
      return this.createContentTypeWithId(id, props)
    },

    async createContentTypeWithId(id: string, props: CreateContentTypeProps): Promise<ContentType> {
      const env = getEnvironmentStorage(spaceId, envId)
      const now = new Date().toISOString()

      const data: ContentTypeData = {
        sys: {
          id,
          type: 'ContentType',
          version: 1,
          createdAt: now,
          updatedAt: now,
          space: { sys: { id: spaceId, type: 'Link', linkType: 'Space' } },
          environment: { sys: { id: envId, type: 'Link', linkType: 'Environment' } },
        },
        name: props.name,
        description: props.description,
        displayField: props.displayField,
        fields: JSON.parse(JSON.stringify(props.fields)),
      }

      env.contentTypes.set(id, data)
      return createContentTypeObject(spaceId, envId, data)
    },

    async getContentType(id: string): Promise<ContentType> {
      const env = getEnvironmentStorage(spaceId, envId)
      const data = env.contentTypes.get(id)
      if (!data) throw new NotFoundError(`ContentType ${id} not found`)
      return createContentTypeObject(spaceId, envId, data)
    },

    async getContentTypes(query?: ContentTypesQuery): Promise<ContentTypeCollection> {
      const env = getEnvironmentStorage(spaceId, envId)
      let items = Array.from(env.contentTypes.values())

      const total = items.length
      const skip = query?.skip || 0
      const limit = query?.limit || 100

      items = items.slice(skip, skip + limit)

      return {
        items: items.map((d) => createContentTypeObject(spaceId, envId, d)),
        total,
        skip,
        limit,
      }
    },

    // Locales
    async createLocale(props: CreateLocaleProps): Promise<Locale> {
      const space = getSpaceStorage(spaceId)
      const id = props.code

      const data: LocaleData = {
        id,
        name: props.name,
        code: props.code,
        fallbackCode: props.fallbackCode ?? null,
        default: props.default ?? false,
        contentManagementApi: props.contentManagementApi ?? true,
        contentDeliveryApi: props.contentDeliveryApi ?? true,
        optional: props.optional ?? false,
        version: 1,
      }

      space.locales.set(id, data)

      return {
        sys: { id, type: 'Locale', version: 1 },
        ...data,
        async update() {
          return this
        },
        async delete() {
          space.locales.delete(id)
        },
      }
    },

    async getLocale(id: string): Promise<Locale> {
      const space = getSpaceStorage(spaceId)
      const data = space.locales.get(id)
      if (!data) throw new NotFoundError(`Locale ${id} not found`)

      return {
        sys: { id, type: 'Locale', version: data.version },
        ...data,
        async update() {
          return this
        },
        async delete() {
          space.locales.delete(id)
        },
      }
    },

    async getLocales(): Promise<LocaleCollection> {
      const space = getSpaceStorage(spaceId)
      const items = Array.from(space.locales.values()).map((data) => ({
        sys: { id: data.id, type: 'Locale' as const, version: data.version },
        ...data,
        async update() {
          return this
        },
        async delete() {
          space.locales.delete(data.id)
        },
      }))

      return { items, total: items.length }
    },

    // Tags
    async createTag(id: string, name: string, visibility: 'public' | 'private' = 'public'): Promise<Tag> {
      const env = getEnvironmentStorage(spaceId, envId)
      const now = new Date().toISOString()

      const data: TagData = {
        id,
        name,
        visibility,
        createdAt: now,
        updatedAt: now,
        version: 1,
      }

      env.tags.set(id, data)

      return {
        sys: { id, type: 'Tag', version: 1, visibility, createdAt: now, updatedAt: now },
        name,
        async update() {
          return this
        },
        async delete() {
          env.tags.delete(id)
        },
      }
    },

    async getTag(id: string): Promise<Tag> {
      const env = getEnvironmentStorage(spaceId, envId)
      const data = env.tags.get(id)
      if (!data) throw new NotFoundError(`Tag ${id} not found`)

      return {
        sys: { id, type: 'Tag', version: data.version, visibility: data.visibility, createdAt: data.createdAt, updatedAt: data.updatedAt },
        name: data.name,
        async update() {
          return this
        },
        async delete() {
          env.tags.delete(id)
        },
      }
    },

    async getTags(): Promise<TagCollection> {
      const env = getEnvironmentStorage(spaceId, envId)
      const items = Array.from(env.tags.values()).map((data) => ({
        sys: { id: data.id, type: 'Tag' as const, version: data.version, visibility: data.visibility, createdAt: data.createdAt, updatedAt: data.updatedAt },
        name: data.name,
        async update() {
          return this
        },
        async delete() {
          env.tags.delete(data.id)
        },
      }))

      return { items, total: items.length }
    },
  }
}

// =============================================================================
// Space Implementation
// =============================================================================

function createSpaceObject(spaceId: string): Space {
  const spaceStorage = getSpaceStorage(spaceId)

  return {
    sys: {
      id: spaceId,
      type: 'Space',
    },
    name: spaceStorage.name,

    async getEnvironment(environmentId: string): Promise<Environment> {
      return createEnvironmentObject(spaceId, environmentId)
    },

    async getEnvironments(): Promise<EnvironmentCollection> {
      const space = getSpaceStorage(spaceId)
      const items: Environment[] = []
      for (const envId of space.environments.keys()) {
        items.push(createEnvironmentObject(spaceId, envId))
      }
      // Always include master
      if (!space.environments.has('master')) {
        items.push(createEnvironmentObject(spaceId, 'master'))
      }
      return { items, total: items.length }
    },

    async createEnvironment(props: CreateEnvironmentProps): Promise<Environment> {
      const envId = props.name.toLowerCase().replace(/\s+/g, '-')
      const space = getSpaceStorage(spaceId)
      space.environments.set(envId, {
        id: envId,
        name: props.name,
        assets: new Map(),
        entries: new Map(),
        contentTypes: new Map(),
        uploads: new Map(),
        tags: new Map(),
      })
      return createEnvironmentObject(spaceId, envId)
    },

    async getContentTypes(): Promise<ContentTypeCollection> {
      const env = createEnvironmentObject(spaceId, 'master')
      return env.getContentTypes()
    },

    async getLocales(): Promise<LocaleCollection> {
      const env = createEnvironmentObject(spaceId, 'master')
      return env.getLocales()
    },
  }
}

// =============================================================================
// Client Factory
// =============================================================================

export function createClient(_config: ContentfulClientConfig): ContentfulClient {
  return {
    async getSpace(spaceId: string): Promise<Space> {
      return createSpaceObject(spaceId)
    },
  }
}

// =============================================================================
// Image Transform Utilities
// =============================================================================

export function getImageUrl(asset: Asset, locale: string, options?: ImageTransformOptions): string {
  const file = asset.fields.file[locale]
  if (!file?.url) {
    throw new ValidationError(`Asset has no URL for locale ${locale}`)
  }

  return buildImageTransformUrl(file.url, options || {})
}

export function buildImageTransformUrl(baseUrl: string, options: ImageTransformOptions): string {
  // Validate options
  if (options.width && options.width > 4000) {
    throw new ValidationError('Width cannot exceed 4000px')
  }
  if (options.height && options.height > 4000) {
    throw new ValidationError('Height cannot exceed 4000px')
  }
  if (options.quality !== undefined && (options.quality < 1 || options.quality > 100)) {
    throw new ValidationError('Quality must be between 1 and 100')
  }

  const url = new URL(baseUrl)

  if (options.width) url.searchParams.set('w', String(options.width))
  if (options.height) url.searchParams.set('h', String(options.height))
  if (options.fit) url.searchParams.set('fit', options.fit)
  if (options.focus) url.searchParams.set('f', options.focus)
  if (options.format) url.searchParams.set('fm', options.format)
  if (options.quality) url.searchParams.set('q', String(options.quality))
  if (options.radius !== undefined) url.searchParams.set('r', String(options.radius))
  if (options.backgroundColor) url.searchParams.set('bg', options.backgroundColor)
  if (options.progressive) url.searchParams.set('fl', 'progressive')
  if (options.png8) url.searchParams.set('fl', 'png8')

  return url.toString()
}

// =============================================================================
// Test Utilities
// =============================================================================

export function _clearAll(): void {
  globalStorage.clear()
}

export function _getAssets(): Asset[] {
  const assets: Asset[] = []
  for (const [spaceId, space] of globalStorage) {
    for (const [envId, env] of space.environments) {
      for (const data of env.assets.values()) {
        assets.push(createAssetObject(spaceId, envId, data))
      }
    }
  }
  return assets
}
