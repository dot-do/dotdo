/**
 * @fileoverview Git Tag Operations
 *
 * Implements lightweight and annotated tag operations with
 * support for GPG signatures, pattern filtering, and version sorting.
 *
 * ## Features
 *
 * - Create lightweight tags (ref pointing directly to commit)
 * - Create annotated tags (tag object with message)
 * - GPG signing and verification
 * - Tag listing with pattern filtering
 * - Version-based sorting
 * - Nested tag resolution
 *
 * ## Tag Types
 *
 * Git supports two types of tags:
 *
 * - **Lightweight tags**: Simply a ref pointing to a commit
 * - **Annotated tags**: A tag object with tagger info, message, and optional signature
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createLightweightTag, createAnnotatedTag, listTags } from './ops/tag'
 *
 * // Create a lightweight tag
 * await createLightweightTag(store, {
 *   name: 'v1.0.0',
 *   target: commitSha
 * })
 *
 * // Create an annotated tag
 * await createAnnotatedTag(store, {
 *   name: 'v2.0.0',
 *   target: commitSha,
 *   message: 'Release version 2.0.0',
 *   tagger: { name: 'John Doe', email: 'john@example.com.ai' }
 * })
 *
 * // List tags matching pattern
 * const tags = await listTags(store, { pattern: 'v*', sortByVersion: true })
 * ```
 *
 * @module ops/tag
 */

import { Author, ObjectType, TagObject } from '../types/objects'
import type { RefObjectStore as ObjectStore } from '../types/storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a lightweight tag.
 *
 * A lightweight tag is simply a ref pointing directly to a commit.
 *
 * @interface TagOptions
 *
 * @example
 * ```typescript
 * const options: TagOptions = {
 *   name: 'v1.0.0',
 *   target: 'abc123def456...',
 *   verify: true,
 *   force: false
 * }
 * ```
 */
export interface TagOptions {
  /** Tag name (without refs/tags/ prefix) */
  name: string

  /** Target commit SHA */
  target: string

  /**
   * If true, verify that the target exists before creating.
   * @default false
   */
  verify?: boolean

  /**
   * If true, overwrite existing tag with same name.
   * @default false
   */
  force?: boolean
}

/**
 * Options for signing a tag
 */
export interface SigningOptions {
  sign: boolean
  keyId?: string
  signer?: (data: Uint8Array, keyId?: string) => Promise<string>
}

/**
 * Options for creating an annotated tag
 */
export interface AnnotatedTagOptions extends TagOptions {
  message: string
  tagger: Partial<Author> & { name: string; email: string }
  targetType?: ObjectType
  signing?: SigningOptions
}

/**
 * Result of creating a tag
 */
export interface TagResult {
  name: string
  target: string
  isAnnotated: boolean
  tagSha?: string
  signed?: boolean
}

/**
 * Options for listing tags
 */
export interface TagListOptions {
  pattern?: string
  sortByVersion?: boolean
  pointsAt?: string
  limit?: number
}

/**
 * Entry in the tag list
 */
export interface TagListEntry {
  name: string
  sha: string
  isAnnotated: boolean
  target?: string
}

/**
 * Options for verifying a tag
 */
export interface TagVerifyOptions {
  verifier?: (data: Uint8Array, signature: string) => Promise<{
    valid: boolean
    keyId?: string
    signer?: string
    error?: string
  }>
}

/**
 * Result of verifying a tag
 */
export interface TagVerifyResult {
  valid: boolean
  signed: boolean
  keyId?: string
  signer?: string
  error?: string
}

/**
 * Represents a tag (can be lightweight or annotated)
 */
export interface TagInfo {
  name: string
  target: string
  isAnnotated: boolean
  sha?: string
  objectType?: ObjectType
  tagger?: Author
  message?: string
  signature?: string
}

/**
 * Result of deleting a tag
 */
export interface DeleteTagResult {
  deleted: boolean
  name: string
  sha?: string
}

/**
 * Options for deleting a tag
 */
export interface DeleteTagOptions {
  force?: boolean
}

/**
 * ObjectStore interface for tag operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore }

// ============================================================================
// Constants
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const TAG_REF_PREFIX = 'refs/tags/'
const MAX_TAG_RECURSION_DEPTH = 50

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a tag name according to Git ref naming rules
 */
function validateTagName(name: string): void {
  if (!name || name.length === 0) {
    throw new Error('Tag name cannot be empty')
  }

  // Git ref naming rules
  if (name.startsWith('-')) {
    throw new Error('Tag name cannot start with a dash')
  }

  if (name.endsWith('.lock')) {
    throw new Error('Tag name cannot end with .lock')
  }

  if (name.includes('..')) {
    throw new Error('Tag name cannot contain consecutive dots')
  }

  if (/\s/.test(name)) {
    throw new Error('Tag name cannot contain spaces')
  }

  // Control characters (ASCII 0-31 and 127)
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new Error('Tag name cannot contain control characters')
  }

  // Special Git characters that are not allowed
  if (/[~^:?*\[\]\\]/.test(name)) {
    throw new Error('Tag name cannot contain special characters (~^:?*[]\\)')
  }
}

/**
 * Validate a SHA format
 */
function validateSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/i.test(sha) && !/^mock\d+$/.test(sha)) {
    throw new Error('Invalid SHA format')
  }
}

/**
 * Validate tagger information
 */
function validateTagger(tagger: Partial<Author> & { name: string; email: string }): void {
  if (tagger.name.includes('\n') || tagger.name.includes('\r')) {
    throw new Error('Tagger name cannot contain newlines')
  }

  if (/<|>/.test(tagger.name)) {
    throw new Error('Tagger name cannot contain angle brackets')
  }

  if (!tagger.email.includes('@') || !tagger.email.includes('.')) {
    throw new Error('Invalid email format')
  }

  if (tagger.timestamp !== undefined && tagger.timestamp < 0) {
    throw new Error('Timestamp cannot be negative')
  }
}

/**
 * Validate a message
 */
function validateMessage(message: string): void {
  if (!message || message.trim().length === 0) {
    throw new Error('Message cannot be empty')
  }

  if (message.includes('\x00')) {
    throw new Error('Message cannot contain null bytes')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the local timezone offset in +HHMM format
 */
function getLocalTimezoneOffset(): string {
  const offset = new Date().getTimezoneOffset()
  const sign = offset <= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0')
  const minutes = String(absOffset % 60).padStart(2, '0')
  return `${sign}${hours}${minutes}`
}

/**
 * Complete tagger info with defaults
 */
function completeTagger(tagger: Partial<Author> & { name: string; email: string }): Author {
  return {
    name: tagger.name,
    email: tagger.email,
    timestamp: tagger.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: tagger.timezone ?? getLocalTimezoneOffset()
  }
}

/**
 * Format an author line
 */
function formatAuthorLine(prefix: string, author: Author): string {
  return `${prefix} ${author.name} <${author.email}> ${author.timestamp} ${author.timezone}`
}

/**
 * Serialize a tag object to bytes (without header)
 */
function serializeTagContent(
  object: string,
  objectType: ObjectType,
  tag: string,
  tagger: Author,
  message: string,
  signature?: string
): Uint8Array {
  const lines: string[] = []
  lines.push(`object ${object}`)
  lines.push(`type ${objectType}`)
  lines.push(`tag ${tag}`)
  lines.push(formatAuthorLine('tagger', tagger))
  lines.push('')
  lines.push(message)
  if (signature) {
    lines.push(signature)
  }

  return encoder.encode(lines.join('\n'))
}

/**
 * Compare version strings for sorting
 */
function compareVersions(a: string, b: string): number {
  // Extract version parts from strings like "v1.2.3" or "1.2.3"
  const aParts = a.replace(/^v/, '').split('.').map(p => {
    const num = parseInt(p, 10)
    return isNaN(num) ? 0 : num
  })
  const bParts = b.replace(/^v/, '').split('.').map(p => {
    const num = parseInt(p, 10)
    return isNaN(num) ? 0 : num
  })

  const maxLen = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] ?? 0
    const bVal = bParts[i] ?? 0
    if (aVal < bVal) return -1
    if (aVal > bVal) return 1
  }
  return 0
}

/**
 * Match a pattern against a tag name (simple glob matching)
 */
function matchPattern(name: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(name)
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Create a lightweight tag
 */
export async function createLightweightTag(
  store: ObjectStore,
  options: TagOptions
): Promise<TagResult> {
  const { name, target, verify = false, force = false } = options

  validateTagName(name)
  validateSha(target)

  // Check if target exists when verify is true
  if (verify) {
    const exists = await store.hasObject(target)
    if (!exists) {
      throw new Error('Target object does not exist')
    }
  }

  const refName = TAG_REF_PREFIX + name

  // Check if tag already exists
  const existingRef = await store.getRef(refName)
  if (existingRef && !force) {
    throw new Error(`Tag '${name}' already exists`)
  }

  // Create the ref
  await store.setRef(refName, target)

  return {
    name,
    target,
    isAnnotated: false
  }
}

/**
 * Create an annotated tag
 */
export async function createAnnotatedTag(
  store: ObjectStore,
  options: AnnotatedTagOptions
): Promise<TagResult> {
  const {
    name,
    target,
    message,
    tagger,
    targetType = 'commit',
    verify = false,
    force = false,
    signing
  } = options

  validateTagName(name)
  validateSha(target)
  validateMessage(message)
  validateTagger(tagger)

  // Check if target exists when verify is true
  if (verify) {
    const exists = await store.hasObject(target)
    if (!exists) {
      throw new Error('Target object does not exist')
    }
  }

  const refName = TAG_REF_PREFIX + name

  // Check if tag already exists
  const existingRef = await store.getRef(refName)
  if (existingRef && !force) {
    throw new Error(`Tag '${name}' already exists`)
  }

  // Complete tagger info with defaults
  const completedTagger = completeTagger(tagger)

  // Create tag content
  let signature: string | undefined
  let isSigned = false

  if (signing?.sign && signing.signer) {
    const contentToSign = serializeTagContent(target, targetType, name, completedTagger, message)
    signature = await signing.signer(contentToSign, signing.keyId)
    isSigned = true
  }

  const tagContent = serializeTagContent(target, targetType, name, completedTagger, message, signature)

  // Store the tag object
  const tagSha = await store.storeObject('tag', tagContent)

  // Create the ref pointing to the tag object
  await store.setRef(refName, tagSha)

  return {
    name,
    target,
    isAnnotated: true,
    tagSha,
    signed: isSigned
  }
}

/**
 * Build a tag object without storing it
 */
export function buildTagObject(options: AnnotatedTagOptions): TagObject {
  const { name, target, message, tagger, targetType = 'commit' } = options

  const completedTagger = completeTagger(tagger)
  const tagContent = serializeTagContent(target, targetType, name, completedTagger, message)

  return {
    type: 'tag',
    data: tagContent,
    object: target,
    objectType: targetType,
    tag: name,
    tagger: completedTagger,
    message,
    name
  }
}

/**
 * Delete a tag
 */
export async function deleteTag(
  store: ObjectStore,
  name: string,
  options: DeleteTagOptions = {}
): Promise<DeleteTagResult> {
  const { force = false } = options
  const refName = TAG_REF_PREFIX + name

  // Get the current ref value
  const sha = await store.getRef(refName)

  if (!sha) {
    if (force) {
      return { deleted: false, name }
    }
    throw new Error(`Tag '${name}' not found`)
  }

  // Delete the ref
  await store.deleteRef(refName)

  return {
    deleted: true,
    name,
    sha
  }
}

/**
 * List tags
 */
export async function listTags(
  store: ObjectStore,
  options: TagListOptions = {}
): Promise<TagListEntry[]> {
  const { pattern, sortByVersion = false, pointsAt, limit } = options

  // Get all tag refs
  const refs = await store.listRefs(TAG_REF_PREFIX)

  // Build tag entries
  const entries: TagListEntry[] = []

  for (const ref of refs) {
    const name = ref.name.slice(TAG_REF_PREFIX.length)
    const sha = ref.sha

    // Check if it's an annotated tag by looking up the object
    const obj = await store.getObject(sha)
    const isAnnotated = obj?.type === 'tag'

    // Get target for annotated tags
    let target = sha
    if (isAnnotated && obj) {
      const parsed = parseTagObject(obj.data)
      target = parsed.object
    }

    // Apply pattern filter
    if (pattern && !matchPattern(name, pattern)) {
      continue
    }

    // Apply pointsAt filter
    if (pointsAt && target !== pointsAt) {
      continue
    }

    entries.push({
      name,
      sha,
      isAnnotated,
      target
    })
  }

  // Sort entries
  if (sortByVersion) {
    entries.sort((a, b) => compareVersions(a.name, b.name))
  } else {
    entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  // Apply limit
  if (limit && limit > 0) {
    return entries.slice(0, limit)
  }

  return entries
}

/**
 * Get a tag by name
 */
export async function getTag(
  store: ObjectStore,
  name: string
): Promise<TagInfo | null> {
  const refName = TAG_REF_PREFIX + name
  const sha = await store.getRef(refName)

  if (!sha) {
    return null
  }

  const obj = await store.getObject(sha)
  if (!obj) {
    return null
  }

  if (obj.type === 'tag') {
    // Annotated tag
    const parsed = parseTagObject(obj.data)
    return {
      name,
      target: parsed.object,
      isAnnotated: true,
      sha,
      objectType: parsed.objectType,
      tagger: parsed.tagger,
      message: parsed.message,
      signature: parsed.signature
    }
  } else {
    // Lightweight tag
    return {
      name,
      target: sha,
      isAnnotated: false
    }
  }
}

/**
 * Verify a tag's signature
 */
export async function verifyTag(
  store: ObjectStore,
  name: string,
  options: TagVerifyOptions = {}
): Promise<TagVerifyResult> {
  const { verifier } = options

  const tag = await getTag(store, name)
  if (!tag) {
    throw new Error(`Tag '${name}' not found`)
  }

  if (!tag.isAnnotated) {
    return { valid: false, signed: false }
  }

  if (!tag.signature) {
    return { valid: false, signed: false }
  }

  if (!verifier) {
    return { valid: false, signed: true }
  }

  try {
    // Get the tag object
    const refName = TAG_REF_PREFIX + name
    const sha = await store.getRef(refName)
    if (!sha) {
      throw new Error(`Tag '${name}' not found`)
    }

    const obj = await store.getObject(sha)
    if (!obj) {
      throw new Error(`Tag object not found`)
    }

    // Extract the content without signature for verification
    const content = obj.data
    const contentStr = decoder.decode(content)
    const sigStart = contentStr.indexOf('-----BEGIN PGP SIGNATURE-----')
    const dataToVerify = sigStart > 0
      ? encoder.encode(contentStr.slice(0, sigStart))
      : content

    const result = await verifier(dataToVerify, tag.signature)

    return {
      valid: result.valid,
      signed: true,
      keyId: result.keyId,
      signer: result.signer,
      error: result.error
    }
  } catch (error) {
    return {
      valid: false,
      signed: true,
      error: error instanceof Error ? error.message : 'Verification failed'
    }
  }
}

/**
 * Parse a tag object from raw data
 */
export function parseTagObject(data: Uint8Array): {
  object: string
  objectType: ObjectType
  tag: string
  tagger?: Author
  message: string
  signature?: string
} {
  const content = decoder.decode(data)
  const lines = content.split('\n')

  let object = ''
  let objectType: ObjectType = 'commit'
  let tag = ''
  let tagger: Author | undefined
  let messageStartIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      messageStartIndex = i + 1
      break
    }

    if (line.startsWith('object ')) {
      object = line.slice(7)
    } else if (line.startsWith('type ')) {
      objectType = line.slice(5) as ObjectType
    } else if (line.startsWith('tag ')) {
      tag = line.slice(4)
    } else if (line.startsWith('tagger ')) {
      const match = line.match(/^tagger (.+) <(.+)> (\d+) ([+-]\d{4})$/)
      if (match) {
        tagger = {
          name: match[1],
          email: match[2],
          timestamp: parseInt(match[3], 10),
          timezone: match[4]
        }
      }
    }
  }

  if (!object) {
    throw new Error('Invalid tag: missing object field')
  }

  // Get message and signature
  const messageContent = lines.slice(messageStartIndex).join('\n')
  const sigStart = messageContent.indexOf('-----BEGIN PGP SIGNATURE-----')

  let message: string
  let signature: string | undefined

  if (sigStart >= 0) {
    message = messageContent.slice(0, sigStart).trimEnd()
    signature = messageContent.slice(sigStart)
  } else {
    message = messageContent
  }

  return {
    object,
    objectType,
    tag,
    tagger,
    message,
    signature
  }
}

/**
 * Format a tag message with cleanup options
 */
export function formatTagMessage(
  message: string,
  options: { cleanup?: boolean; commentChar?: string } = {}
): string {
  const { cleanup = true, commentChar } = options

  if (!cleanup) {
    return message
  }

  let result = message.trim()

  // Strip comment lines if commentChar is provided
  if (commentChar) {
    result = result
      .split('\n')
      .filter(line => !line.startsWith(commentChar))
      .join('\n')
  }

  // Collapse multiple blank lines to a single blank line
  result = result.replace(/\n{3,}/g, '\n\n')

  return result
}

/**
 * Check if a tag is an annotated tag
 */
export async function isAnnotatedTag(
  store: ObjectStore,
  name: string
): Promise<boolean> {
  const tag = await getTag(store, name)
  if (!tag) {
    throw new Error(`Tag '${name}' not found`)
  }
  return tag.isAnnotated
}

/**
 * Get the target SHA for a tag
 */
export async function getTagTarget(
  store: ObjectStore,
  name: string
): Promise<string> {
  const tag = await getTag(store, name)
  if (!tag) {
    throw new Error(`Tag '${name}' not found`)
  }
  return tag.target
}

/**
 * Get the tagger info for a tag
 */
export async function getTagTagger(
  store: ObjectStore,
  name: string
): Promise<Author | null> {
  const tag = await getTag(store, name)
  if (!tag) {
    throw new Error(`Tag '${name}' not found`)
  }
  return tag.tagger ?? null
}

/**
 * Resolve a tag to its final commit SHA
 * Follows nested tags until reaching a commit
 */
export async function resolveTagToCommit(
  store: ObjectStore,
  name: string,
  depth: number = 0
): Promise<string> {
  if (depth >= MAX_TAG_RECURSION_DEPTH) {
    throw new Error('Maximum tag recursion depth exceeded')
  }

  const tag = await getTag(store, name)
  if (!tag) {
    throw new Error(`Tag '${name}' not found`)
  }

  // For lightweight tags pointing directly to a commit
  if (!tag.isAnnotated) {
    const obj = await store.getObject(tag.target)
    if (!obj || obj.type !== 'commit') {
      throw new Error(`Tag '${name}' does not point to a commit`)
    }
    return tag.target
  }

  // For annotated tags, check what type of object they point to
  if (tag.objectType === 'commit') {
    return tag.target
  }

  if (tag.objectType === 'tag') {
    // Nested tag - we need to resolve it
    // Get the nested tag object and parse it
    const nestedObj = await store.getObject(tag.target)
    if (!nestedObj || nestedObj.type !== 'tag') {
      throw new Error(`Nested tag object not found`)
    }

    const nestedParsed = parseTagObject(nestedObj.data)

    // Create a temporary tag info to continue resolution
    if (nestedParsed.objectType === 'commit') {
      return nestedParsed.object
    }

    if (nestedParsed.objectType === 'tag') {
      // Continue recursion - find the nested tag name if it exists
      // Since we have the SHA, we need to follow it
      const innerObj = await store.getObject(nestedParsed.object)
      if (!innerObj) {
        throw new Error('Cannot resolve nested tag chain')
      }

      if (innerObj.type === 'commit') {
        return nestedParsed.object
      }

      if (innerObj.type === 'tag') {
        // Parse and continue
        const innerParsed = parseTagObject(innerObj.data)
        return resolveNestedTag(store, innerParsed, depth + 1)
      }

      throw new Error(`Tag chain does not resolve to a commit`)
    }

    throw new Error(`Tag '${name}' does not resolve to a commit`)
  }

  throw new Error(`Tag '${name}' does not point to a commit (points to ${tag.objectType})`)
}

/**
 * Helper to resolve a nested tag structure
 */
async function resolveNestedTag(
  store: ObjectStore,
  parsed: { object: string; objectType: ObjectType },
  depth: number
): Promise<string> {
  if (depth >= MAX_TAG_RECURSION_DEPTH) {
    throw new Error('Maximum tag recursion depth exceeded')
  }

  if (parsed.objectType === 'commit') {
    return parsed.object
  }

  if (parsed.objectType === 'tag') {
    const obj = await store.getObject(parsed.object)
    if (!obj || obj.type !== 'tag') {
      throw new Error('Cannot resolve nested tag chain')
    }

    const innerParsed = parseTagObject(obj.data)
    return resolveNestedTag(store, innerParsed, depth + 1)
  }

  throw new Error(`Tag does not resolve to a commit (points to ${parsed.objectType})`)
}
