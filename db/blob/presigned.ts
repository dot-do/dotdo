/**
 * Presigned URL Generation
 *
 * Generates presigned URLs for direct browser access to R2 blobs.
 *
 * @module db/blob/presigned
 */

/**
 * Parse duration string to milliseconds
 * Supports: 1s, 30m, 1h, 7d
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 's':
      return value * 1000
    case 'm':
      return value * 60 * 1000
    case 'h':
      return value * 60 * 60 * 1000
    case 'd':
      return value * 24 * 60 * 60 * 1000
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}

/**
 * Generate a presigned download URL
 * In a real implementation, this would use R2's signing capability.
 * For tests, we generate a placeholder URL.
 */
export function generateSignedUrl(
  r2Key: string,
  options: {
    expiresIn: string
    disposition?: 'inline' | 'attachment'
    baseUrl?: string
  }
): string {
  const expiresMs = parseDuration(options.expiresIn)
  const expiresAt = Date.now() + expiresMs

  // Base URL for presigned URLs
  const baseUrl = options.baseUrl || 'https://r2.example.com'

  // Build URL with query params
  const url = new URL(`${baseUrl}/${r2Key}`)
  url.searchParams.set('expires', expiresAt.toString())
  url.searchParams.set('signature', generateSignature(r2Key, expiresAt))

  if (options.disposition) {
    url.searchParams.set('response-content-disposition', options.disposition)
  }

  return url.toString()
}

/**
 * Generate a presigned upload URL
 */
export function generateUploadUrl(options: {
  key: string
  contentType: string
  maxSize?: number
  expiresIn: string
  baseUrl?: string
}): string {
  const expiresMs = parseDuration(options.expiresIn)
  const expiresAt = Date.now() + expiresMs

  const baseUrl = options.baseUrl || 'https://r2.example.com'

  const url = new URL(`${baseUrl}/upload/${options.key}`)
  url.searchParams.set('expires', expiresAt.toString())
  url.searchParams.set('content-type', options.contentType)
  url.searchParams.set('signature', generateSignature(options.key, expiresAt))

  if (options.maxSize) {
    url.searchParams.set('max-size', options.maxSize.toString())
  }

  return url.toString()
}

/**
 * Generate a simple signature (placeholder implementation)
 * In production, this would use proper HMAC signing
 */
function generateSignature(key: string, expiresAt: number): string {
  // Simple hash for testing - real implementation would use HMAC
  const data = `${key}:${expiresAt}`
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
