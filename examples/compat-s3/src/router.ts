/**
 * S3-compatible HTTP API Router
 *
 * Implements the S3 REST API using Hono, routing to Durable Objects.
 *
 * Supported operations:
 * - Service: ListBuckets
 * - Bucket: CreateBucket, DeleteBucket, HeadBucket, ListObjectsV2, ListMultipartUploads
 * - Object: GetObject, PutObject, DeleteObject, HeadObject, CopyObject
 * - Multipart: CreateMultipartUpload, UploadPart, CompleteMultipartUpload, AbortMultipartUpload, ListParts
 * - ACL: GetBucketAcl, PutBucketAcl, GetObjectAcl, PutObjectAcl
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html
 */

import { Hono } from 'hono'
import type { S3DO } from './S3DO'
import type { Env, S3Error } from './types'
import { S3Errors } from './types'

// ============================================================================
// Types
// ============================================================================

interface S3Env {
  S3_DO: DurableObjectNamespace
  R2_STORAGE: R2Bucket
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
}

// ============================================================================
// XML Response Helpers
// ============================================================================

function xmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/xml',
      'x-amz-request-id': crypto.randomUUID(),
    },
  })
}

function errorResponse(error: S3Error): Response {
  return new Response(error.toXML(), {
    status: error.statusCode,
    headers: {
      'Content-Type': 'application/xml',
      'x-amz-request-id': crypto.randomUUID(),
    },
  })
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================================================
// S3 DO Accessor
// ============================================================================

function getS3DO(env: S3Env): DurableObjectStub {
  const id = env.S3_DO.idFromName('s3')
  return env.S3_DO.get(id)
}

// ============================================================================
// Router Setup
// ============================================================================

export const s3Router = new Hono<{ Bindings: S3Env }>()

// ============================================================================
// Service Operations
// ============================================================================

/**
 * GET / - ListBuckets
 * Returns a list of all buckets owned by the authenticated user
 */
s3Router.get('/', async (c) => {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/listBuckets', {
      method: 'POST',
    }))
    const result = await response.json() as {
      owner: { id: string; displayName?: string }
      buckets: Array<{ name: string; creationDate: Date }>
    }

    const bucketsXml = result.buckets
      .map(b => `
    <Bucket>
      <Name>${escapeXml(b.name)}</Name>
      <CreationDate>${new Date(b.creationDate).toISOString()}</CreationDate>
    </Bucket>`)
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>${result.owner.id}</ID>
    <DisplayName>${escapeXml(result.owner.displayName ?? '')}</DisplayName>
  </Owner>
  <Buckets>${bucketsXml}
  </Buckets>
</ListAllMyBucketsResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

// ============================================================================
// Bucket Operations
// ============================================================================

/**
 * PUT /:bucket - CreateBucket
 */
s3Router.put('/:bucket', async (c) => {
  const bucket = c.req.param('bucket')

  // Check for query params that indicate other operations
  const acl = c.req.query('acl')
  if (acl !== undefined) {
    // PutBucketAcl
    return handlePutBucketAcl(c, bucket)
  }

  try {
    const stub = getS3DO(c.env)

    // Parse CreateBucketConfiguration if present
    let region: string | undefined
    const body = await c.req.text()
    if (body) {
      const regionMatch = body.match(/<LocationConstraint>([^<]+)<\/LocationConstraint>/)
      if (regionMatch) {
        region = regionMatch[1]
      }
    }

    const response = await stub.fetch(new Request('http://do/createBucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bucket,
        region,
        acl: c.req.header('x-amz-acl'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      throw S3Errors.BucketAlreadyExists(bucket)
    }

    return new Response(null, {
      status: 200,
      headers: {
        'Location': `/${bucket}`,
        'x-amz-request-id': crypto.randomUUID(),
      },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

/**
 * DELETE /:bucket - DeleteBucket
 */
s3Router.delete('/:bucket', async (c) => {
  const bucket = c.req.param('bucket')

  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/deleteBucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bucket }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchBucket') {
        throw S3Errors.NoSuchBucket(bucket)
      }
      if (error.code === 'BucketNotEmpty') {
        throw S3Errors.BucketNotEmpty(bucket)
      }
      throw new Error(error.message)
    }

    return new Response(null, {
      status: 204,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

/**
 * HEAD /:bucket - HeadBucket
 */
s3Router.on('HEAD', '/:bucket', async (c) => {
  const bucket = c.req.param('bucket')

  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/headBucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: bucket }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as { region?: string }

    return new Response(null, {
      status: 200,
      headers: {
        'x-amz-request-id': crypto.randomUUID(),
        'x-amz-bucket-region': result.region ?? 'us-east-1',
      },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return new Response(null, {
        status: (e as S3Error).statusCode,
        headers: { 'x-amz-request-id': crypto.randomUUID() },
      })
    }
    throw e
  }
})

/**
 * GET /:bucket - ListObjectsV2 or GetBucketAcl
 */
s3Router.get('/:bucket', async (c) => {
  const bucket = c.req.param('bucket')

  // Check for ACL operation
  if (c.req.query('acl') !== undefined) {
    return handleGetBucketAcl(c, bucket)
  }

  // Check for uploads operation (ListMultipartUploads)
  if (c.req.query('uploads') !== undefined) {
    return handleListMultipartUploads(c, bucket)
  }

  // ListObjectsV2
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/listObjectsV2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        prefix: c.req.query('prefix'),
        delimiter: c.req.query('delimiter'),
        maxKeys: c.req.query('max-keys') ? parseInt(c.req.query('max-keys')!) : undefined,
        continuationToken: c.req.query('continuation-token'),
        startAfter: c.req.query('start-after'),
        fetchOwner: c.req.query('fetch-owner') === 'true',
        encodingType: c.req.query('encoding-type'),
      }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      name: string
      prefix?: string
      delimiter?: string
      maxKeys: number
      isTruncated: boolean
      contents: Array<{
        key: string
        size: number
        etag: string
        lastModified: string | Date
        storageClass?: string
      }>
      commonPrefixes: Array<{ prefix: string }>
      continuationToken?: string
      nextContinuationToken?: string
      startAfter?: string
      keyCount: number
    }

    const contentsXml = result.contents
      .map(obj => `
    <Contents>
      <Key>${escapeXml(obj.key)}</Key>
      <LastModified>${new Date(obj.lastModified).toISOString()}</LastModified>
      <ETag>${obj.etag}</ETag>
      <Size>${obj.size}</Size>
      <StorageClass>${obj.storageClass ?? 'STANDARD'}</StorageClass>
    </Contents>`)
      .join('')

    const commonPrefixesXml = result.commonPrefixes
      .map(cp => `
    <CommonPrefixes>
      <Prefix>${escapeXml(cp.prefix)}</Prefix>
    </CommonPrefixes>`)
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(result.name)}</Name>
  ${result.prefix ? `<Prefix>${escapeXml(result.prefix)}</Prefix>` : '<Prefix/>'}
  ${result.delimiter ? `<Delimiter>${escapeXml(result.delimiter)}</Delimiter>` : ''}
  <MaxKeys>${result.maxKeys}</MaxKeys>
  <KeyCount>${result.keyCount}</KeyCount>
  <IsTruncated>${result.isTruncated}</IsTruncated>
  ${result.continuationToken ? `<ContinuationToken>${result.continuationToken}</ContinuationToken>` : ''}
  ${result.nextContinuationToken ? `<NextContinuationToken>${result.nextContinuationToken}</NextContinuationToken>` : ''}
  ${result.startAfter ? `<StartAfter>${escapeXml(result.startAfter)}</StartAfter>` : ''}${contentsXml}${commonPrefixesXml}
</ListBucketResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

// ============================================================================
// Object Operations
// ============================================================================

/**
 * GET /:bucket/:key+ - GetObject
 */
s3Router.get('/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket')
  const key = c.req.param('key')

  // Check for ACL operation
  if (c.req.query('acl') !== undefined) {
    return handleGetObjectAcl(c, bucket, key)
  }

  // Check for uploadId (ListParts)
  const uploadId = c.req.query('uploadId')
  if (uploadId) {
    return handleListParts(c, bucket, key, uploadId)
  }

  try {
    const stub = getS3DO(c.env)

    // Parse range header
    const rangeHeader = c.req.header('range')
    let range: { start: number; end: number } | undefined
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      if (match) {
        range = {
          start: parseInt(match[1]),
          end: match[2] ? parseInt(match[2]) : Infinity,
        }
      }
    }

    const response = await stub.fetch(new Request('http://do/getObject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        range,
        ifMatch: c.req.header('if-match'),
        ifNoneMatch: c.req.header('if-none-match'),
        ifModifiedSince: c.req.header('if-modified-since'),
        ifUnmodifiedSince: c.req.header('if-unmodified-since'),
        versionId: c.req.query('versionId'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchBucket') {
        throw S3Errors.NoSuchBucket(bucket)
      }
      if (error.code === 'NoSuchKey') {
        throw S3Errors.NoSuchKey(key)
      }
      if (error.code === 'NotModified') {
        return new Response(null, {
          status: 304,
          headers: { 'x-amz-request-id': crypto.randomUUID() },
        })
      }
      if (error.code === 'PreconditionFailed') {
        throw S3Errors.PreconditionFailed()
      }
      throw new Error(error.message)
    }

    const result = await response.json() as {
      body: string // Base64 encoded
      metadata: {
        contentType?: string
        contentEncoding?: string
        cacheControl?: string
        contentDisposition?: string
        contentLanguage?: string
        etag: string
        lastModified: string | Date
        metadata?: Record<string, string>
        storageClass?: string
      }
      contentLength: number
      contentRange?: string
    }

    const headers = new Headers({
      'Content-Type': result.metadata.contentType ?? 'application/octet-stream',
      'Content-Length': result.contentLength.toString(),
      'ETag': result.metadata.etag,
      'Last-Modified': new Date(result.metadata.lastModified).toUTCString(),
      'Accept-Ranges': 'bytes',
      'x-amz-request-id': crypto.randomUUID(),
    })

    if (result.metadata.contentEncoding) {
      headers.set('Content-Encoding', result.metadata.contentEncoding)
    }
    if (result.metadata.cacheControl) {
      headers.set('Cache-Control', result.metadata.cacheControl)
    }
    if (result.metadata.contentDisposition) {
      headers.set('Content-Disposition', result.metadata.contentDisposition)
    }
    if (result.metadata.contentLanguage) {
      headers.set('Content-Language', result.metadata.contentLanguage)
    }
    if (result.contentRange) {
      headers.set('Content-Range', result.contentRange)
    }

    // Add custom metadata
    if (result.metadata.metadata) {
      for (const [k, v] of Object.entries(result.metadata.metadata)) {
        headers.set(`x-amz-meta-${k}`, v)
      }
    }

    // Decode base64 body
    const bodyBytes = Uint8Array.from(atob(result.body), c => c.charCodeAt(0))

    return new Response(bodyBytes, {
      status: result.contentRange ? 206 : 200,
      headers,
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

/**
 * HEAD /:bucket/:key+ - HeadObject
 */
s3Router.on('HEAD', '/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket')
  const key = c.req.param('key')

  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/headObject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        versionId: c.req.query('versionId'),
        ifMatch: c.req.header('if-match'),
        ifNoneMatch: c.req.header('if-none-match'),
        ifModifiedSince: c.req.header('if-modified-since'),
        ifUnmodifiedSince: c.req.header('if-unmodified-since'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchKey' || error.code === 'NoSuchBucket') {
        return new Response(null, {
          status: 404,
          headers: { 'x-amz-request-id': crypto.randomUUID() },
        })
      }
      if (error.code === 'NotModified') {
        return new Response(null, {
          status: 304,
          headers: { 'x-amz-request-id': crypto.randomUUID() },
        })
      }
      return new Response(null, {
        status: 412,
        headers: { 'x-amz-request-id': crypto.randomUUID() },
      })
    }

    const result = await response.json() as {
      size: number
      etag: string
      lastModified: string | Date
      contentType?: string
      contentEncoding?: string
      cacheControl?: string
      contentDisposition?: string
      contentLanguage?: string
      metadata?: Record<string, string>
      storageClass?: string
    }

    const headers = new Headers({
      'Content-Type': result.contentType ?? 'application/octet-stream',
      'Content-Length': result.size.toString(),
      'ETag': result.etag,
      'Last-Modified': new Date(result.lastModified).toUTCString(),
      'Accept-Ranges': 'bytes',
      'x-amz-request-id': crypto.randomUUID(),
    })

    if (result.contentEncoding) {
      headers.set('Content-Encoding', result.contentEncoding)
    }
    if (result.cacheControl) {
      headers.set('Cache-Control', result.cacheControl)
    }
    if (result.contentDisposition) {
      headers.set('Content-Disposition', result.contentDisposition)
    }
    if (result.contentLanguage) {
      headers.set('Content-Language', result.contentLanguage)
    }
    if (result.storageClass) {
      headers.set('x-amz-storage-class', result.storageClass)
    }

    // Add custom metadata
    if (result.metadata) {
      for (const [k, v] of Object.entries(result.metadata)) {
        headers.set(`x-amz-meta-${k}`, v)
      }
    }

    return new Response(null, { status: 200, headers })
  } catch (e) {
    return new Response(null, {
      status: 500,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  }
})

/**
 * PUT /:bucket/:key+ - PutObject or CopyObject or CreateMultipartUpload or UploadPart
 */
s3Router.put('/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket')
  const key = c.req.param('key')

  // Check for ACL operation
  if (c.req.query('acl') !== undefined) {
    return handlePutObjectAcl(c, bucket, key)
  }

  // Check for CopyObject (x-amz-copy-source header)
  const copySource = c.req.header('x-amz-copy-source')
  if (copySource) {
    return handleCopyObject(c, bucket, key, copySource)
  }

  // Check for UploadPart (uploadId and partNumber query params)
  const uploadId = c.req.query('uploadId')
  const partNumber = c.req.query('partNumber')
  if (uploadId && partNumber) {
    return handleUploadPart(c, bucket, key, uploadId, parseInt(partNumber))
  }

  // Regular PutObject
  try {
    const stub = getS3DO(c.env)
    const body = await c.req.arrayBuffer()

    // Parse metadata from x-amz-meta-* headers
    const metadata: Record<string, string> = {}
    for (const [header, value] of c.req.raw.headers.entries()) {
      if (header.toLowerCase().startsWith('x-amz-meta-')) {
        const metaKey = header.slice(11)
        metadata[metaKey] = value
      }
    }

    const response = await stub.fetch(new Request('http://do/putObject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        body: btoa(String.fromCharCode(...new Uint8Array(body))), // Base64 encode
        contentType: c.req.header('content-type'),
        contentEncoding: c.req.header('content-encoding'),
        cacheControl: c.req.header('cache-control'),
        contentDisposition: c.req.header('content-disposition'),
        contentLanguage: c.req.header('content-language'),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        storageClass: c.req.header('x-amz-storage-class'),
        acl: c.req.header('x-amz-acl'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchBucket') {
        throw S3Errors.NoSuchBucket(bucket)
      }
      throw new Error(error.message)
    }

    const result = await response.json() as { etag: string; versionId?: string }

    return new Response(null, {
      status: 200,
      headers: {
        'ETag': result.etag,
        'x-amz-request-id': crypto.randomUUID(),
        ...(result.versionId && { 'x-amz-version-id': result.versionId }),
      },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

/**
 * POST /:bucket/:key+ - CreateMultipartUpload or CompleteMultipartUpload
 */
s3Router.post('/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket')
  const key = c.req.param('key')

  // Check for CompleteMultipartUpload (uploadId query param)
  const uploadId = c.req.query('uploadId')
  if (uploadId) {
    return handleCompleteMultipartUpload(c, bucket, key, uploadId)
  }

  // Check for CreateMultipartUpload (uploads query param)
  if (c.req.query('uploads') !== undefined) {
    return handleCreateMultipartUpload(c, bucket, key)
  }

  // Check for DeleteObjects (delete query param on bucket)
  // Note: This is handled at /:bucket level in S3, but some clients use key path

  return errorResponse(S3Errors.NoSuchKey(key))
})

/**
 * DELETE /:bucket/:key+ - DeleteObject or AbortMultipartUpload
 */
s3Router.delete('/:bucket/:key{.+}', async (c) => {
  const bucket = c.req.param('bucket')
  const key = c.req.param('key')

  // Check for AbortMultipartUpload (uploadId query param)
  const uploadId = c.req.query('uploadId')
  if (uploadId) {
    return handleAbortMultipartUpload(c, bucket, key, uploadId)
  }

  // Regular DeleteObject
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/deleteObject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        versionId: c.req.query('versionId'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchBucket') {
        throw S3Errors.NoSuchBucket(bucket)
      }
      // S3 delete is idempotent - doesn't error on missing key
    }

    return new Response(null, {
      status: 204,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
})

// ============================================================================
// Handler Functions
// ============================================================================

async function handleCopyObject(
  c: any,
  bucket: string,
  key: string,
  copySource: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)

    // Parse copy source (format: /bucket/key or bucket/key)
    const source = copySource.startsWith('/') ? copySource.slice(1) : copySource
    const [sourceBucket, ...keyParts] = source.split('/')
    const sourceKey = decodeURIComponent(keyParts.join('/'))

    const response = await stub.fetch(new Request('http://do/copyObject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceBucket,
        sourceKey,
        destinationBucket: bucket,
        destinationKey: key,
        metadataDirective: c.req.header('x-amz-metadata-directive'),
        contentType: c.req.header('content-type'),
        cacheControl: c.req.header('cache-control'),
        copySourceIfMatch: c.req.header('x-amz-copy-source-if-match'),
        copySourceIfNoneMatch: c.req.header('x-amz-copy-source-if-none-match'),
        copySourceIfModifiedSince: c.req.header('x-amz-copy-source-if-modified-since'),
        copySourceIfUnmodifiedSince: c.req.header('x-amz-copy-source-if-unmodified-since'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchBucket') {
        throw S3Errors.NoSuchBucket(sourceBucket)
      }
      if (error.code === 'NoSuchKey') {
        throw S3Errors.NoSuchKey(sourceKey)
      }
      throw S3Errors.PreconditionFailed()
    }

    const result = await response.json() as {
      etag: string
      lastModified: string | Date
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <ETag>${result.etag}</ETag>
  <LastModified>${new Date(result.lastModified).toISOString()}</LastModified>
</CopyObjectResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleCreateMultipartUpload(
  c: any,
  bucket: string,
  key: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/createMultipartUpload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        contentType: c.req.header('content-type'),
        storageClass: c.req.header('x-amz-storage-class'),
      }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      uploadId: string
      bucket: string
      key: string
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(result.bucket)}</Bucket>
  <Key>${escapeXml(result.key)}</Key>
  <UploadId>${result.uploadId}</UploadId>
</InitiateMultipartUploadResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleUploadPart(
  c: any,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const body = await c.req.arrayBuffer()

    const response = await stub.fetch(new Request('http://do/uploadPart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        uploadId,
        partNumber,
        body: btoa(String.fromCharCode(...new Uint8Array(body))),
        contentMD5: c.req.header('content-md5'),
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchUpload') {
        throw S3Errors.NoSuchUpload(uploadId)
      }
      throw new Error(error.message)
    }

    const result = await response.json() as { etag: string }

    return new Response(null, {
      status: 200,
      headers: {
        'ETag': result.etag,
        'x-amz-request-id': crypto.randomUUID(),
      },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleCompleteMultipartUpload(
  c: any,
  bucket: string,
  key: string,
  uploadId: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const body = await c.req.text()

    // Parse parts from XML
    const parts: Array<{ partNumber: number; etag: string }> = []
    const partMatches = body.matchAll(/<Part>\s*<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]+)<\/ETag>\s*<\/Part>/g)
    for (const match of partMatches) {
      parts.push({
        partNumber: parseInt(match[1]),
        etag: match[2],
      })
    }

    const response = await stub.fetch(new Request('http://do/completeMultipartUpload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        uploadId,
        parts,
      }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchUpload') {
        throw S3Errors.NoSuchUpload(uploadId)
      }
      throw new Error(error.message)
    }

    const result = await response.json() as {
      location: string
      bucket: string
      key: string
      etag: string
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Location>${escapeXml(result.location)}</Location>
  <Bucket>${escapeXml(result.bucket)}</Bucket>
  <Key>${escapeXml(result.key)}</Key>
  <ETag>${result.etag}</ETag>
</CompleteMultipartUploadResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleAbortMultipartUpload(
  c: any,
  bucket: string,
  key: string,
  uploadId: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/abortMultipartUpload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key, uploadId }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchUpload') {
        throw S3Errors.NoSuchUpload(uploadId)
      }
      throw new Error(error.message)
    }

    return new Response(null, {
      status: 204,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleListParts(
  c: any,
  bucket: string,
  key: string,
  uploadId: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/listParts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        key,
        uploadId,
        maxParts: c.req.query('max-parts') ? parseInt(c.req.query('max-parts')!) : undefined,
        partNumberMarker: c.req.query('part-number-marker') ? parseInt(c.req.query('part-number-marker')!) : undefined,
      }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchUpload(uploadId)
    }

    const result = await response.json() as {
      bucket: string
      key: string
      uploadId: string
      partNumberMarker?: number
      nextPartNumberMarker?: number
      maxParts: number
      isTruncated: boolean
      parts: Array<{
        partNumber: number
        etag: string
        size: number
        lastModified: string | Date
      }>
      storageClass?: string
    }

    const partsXml = result.parts
      .map(p => `
    <Part>
      <PartNumber>${p.partNumber}</PartNumber>
      <LastModified>${new Date(p.lastModified).toISOString()}</LastModified>
      <ETag>${p.etag}</ETag>
      <Size>${p.size}</Size>
    </Part>`)
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(result.bucket)}</Bucket>
  <Key>${escapeXml(result.key)}</Key>
  <UploadId>${result.uploadId}</UploadId>
  ${result.partNumberMarker ? `<PartNumberMarker>${result.partNumberMarker}</PartNumberMarker>` : ''}
  ${result.nextPartNumberMarker ? `<NextPartNumberMarker>${result.nextPartNumberMarker}</NextPartNumberMarker>` : ''}
  <MaxParts>${result.maxParts}</MaxParts>
  <IsTruncated>${result.isTruncated}</IsTruncated>
  ${result.storageClass ? `<StorageClass>${result.storageClass}</StorageClass>` : ''}${partsXml}
</ListPartsResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleListMultipartUploads(
  c: any,
  bucket: string
): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/listMultipartUploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket,
        prefix: c.req.query('prefix'),
        delimiter: c.req.query('delimiter'),
        maxUploads: c.req.query('max-uploads') ? parseInt(c.req.query('max-uploads')!) : undefined,
        keyMarker: c.req.query('key-marker'),
        uploadIdMarker: c.req.query('upload-id-marker'),
      }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      bucket: string
      keyMarker?: string
      uploadIdMarker?: string
      nextKeyMarker?: string
      nextUploadIdMarker?: string
      maxUploads: number
      isTruncated: boolean
      uploads: Array<{
        key: string
        uploadId: string
        initiated: string | Date
        storageClass?: string
      }>
      commonPrefixes: Array<{ prefix: string }>
    }

    const uploadsXml = result.uploads
      .map(u => `
    <Upload>
      <Key>${escapeXml(u.key)}</Key>
      <UploadId>${u.uploadId}</UploadId>
      <Initiated>${new Date(u.initiated).toISOString()}</Initiated>
      ${u.storageClass ? `<StorageClass>${u.storageClass}</StorageClass>` : ''}
    </Upload>`)
      .join('')

    const commonPrefixesXml = result.commonPrefixes
      .map(cp => `
    <CommonPrefixes>
      <Prefix>${escapeXml(cp.prefix)}</Prefix>
    </CommonPrefixes>`)
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>${escapeXml(result.bucket)}</Bucket>
  ${result.keyMarker ? `<KeyMarker>${escapeXml(result.keyMarker)}</KeyMarker>` : '<KeyMarker/>'}
  ${result.uploadIdMarker ? `<UploadIdMarker>${result.uploadIdMarker}</UploadIdMarker>` : '<UploadIdMarker/>'}
  ${result.nextKeyMarker ? `<NextKeyMarker>${escapeXml(result.nextKeyMarker)}</NextKeyMarker>` : ''}
  ${result.nextUploadIdMarker ? `<NextUploadIdMarker>${result.nextUploadIdMarker}</NextUploadIdMarker>` : ''}
  <MaxUploads>${result.maxUploads}</MaxUploads>
  <IsTruncated>${result.isTruncated}</IsTruncated>${uploadsXml}${commonPrefixesXml}
</ListMultipartUploadsResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleGetBucketAcl(c: any, bucket: string): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/getBucketAcl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      owner: { id: string; displayName?: string }
      grants: Array<{
        grantee: { type: string; id?: string; displayName?: string; uri?: string }
        permission: string
      }>
    }

    const grantsXml = result.grants
      .map(g => {
        let granteeXml: string
        if (g.grantee.type === 'CanonicalUser') {
          granteeXml = `<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">
        <ID>${g.grantee.id}</ID>
        <DisplayName>${escapeXml(g.grantee.displayName ?? '')}</DisplayName>
      </Grantee>`
        } else {
          granteeXml = `<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Group">
        <URI>${g.grantee.uri}</URI>
      </Grantee>`
        }
        return `
    <Grant>
      ${granteeXml}
      <Permission>${g.permission}</Permission>
    </Grant>`
      })
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<AccessControlPolicy>
  <Owner>
    <ID>${result.owner.id}</ID>
    <DisplayName>${escapeXml(result.owner.displayName ?? '')}</DisplayName>
  </Owner>
  <AccessControlList>${grantsXml}
  </AccessControlList>
</AccessControlPolicy>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handlePutBucketAcl(c: any, bucket: string): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const cannedAcl = c.req.header('x-amz-acl')

    let acl: string | object = cannedAcl ?? 'private'

    // Check for ACL in request body
    const body = await c.req.text()
    if (body) {
      // Parse AccessControlPolicy XML (simplified)
      acl = body
    }

    const response = await stub.fetch(new Request('http://do/putBucketAcl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, acl }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    return new Response(null, {
      status: 200,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handleGetObjectAcl(c: any, bucket: string, key: string): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const response = await stub.fetch(new Request('http://do/getObjectAcl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchKey') {
        throw S3Errors.NoSuchKey(key)
      }
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      owner: { id: string; displayName?: string }
      grants: Array<{
        grantee: { type: string; id?: string; displayName?: string; uri?: string }
        permission: string
      }>
    }

    const grantsXml = result.grants
      .map(g => {
        let granteeXml: string
        if (g.grantee.type === 'CanonicalUser') {
          granteeXml = `<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser">
        <ID>${g.grantee.id}</ID>
        <DisplayName>${escapeXml(g.grantee.displayName ?? '')}</DisplayName>
      </Grantee>`
        } else {
          granteeXml = `<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Group">
        <URI>${g.grantee.uri}</URI>
      </Grantee>`
        }
        return `
    <Grant>
      ${granteeXml}
      <Permission>${g.permission}</Permission>
    </Grant>`
      })
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<AccessControlPolicy>
  <Owner>
    <ID>${result.owner.id}</ID>
    <DisplayName>${escapeXml(result.owner.displayName ?? '')}</DisplayName>
  </Owner>
  <AccessControlList>${grantsXml}
  </AccessControlList>
</AccessControlPolicy>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

async function handlePutObjectAcl(c: any, bucket: string, key: string): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const cannedAcl = c.req.header('x-amz-acl')

    let acl: string | object = cannedAcl ?? 'private'

    const body = await c.req.text()
    if (body) {
      acl = body
    }

    const response = await stub.fetch(new Request('http://do/putObjectAcl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key, acl }),
    }))

    if (!response.ok) {
      const error = await response.json() as { code: string; message: string }
      if (error.code === 'NoSuchKey') {
        throw S3Errors.NoSuchKey(key)
      }
      throw S3Errors.NoSuchBucket(bucket)
    }

    return new Response(null, {
      status: 200,
      headers: { 'x-amz-request-id': crypto.randomUUID() },
    })
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

// ============================================================================
// POST /:bucket for DeleteObjects (batch delete)
// ============================================================================

s3Router.post('/:bucket', async (c) => {
  const bucket = c.req.param('bucket')

  // Check for DeleteObjects (delete query param)
  if (c.req.query('delete') !== undefined) {
    return handleDeleteObjects(c, bucket)
  }

  return errorResponse(S3Errors.NoSuchBucket(bucket))
})

async function handleDeleteObjects(c: any, bucket: string): Promise<Response> {
  try {
    const stub = getS3DO(c.env)
    const body = await c.req.text()

    // Parse Delete XML
    const objects: Array<{ key: string; versionId?: string }> = []
    const objectMatches = body.matchAll(/<Object>\s*<Key>([^<]+)<\/Key>(?:\s*<VersionId>([^<]+)<\/VersionId>)?\s*<\/Object>/g)
    for (const match of objectMatches) {
      objects.push({
        key: match[1],
        versionId: match[2],
      })
    }

    const quiet = body.includes('<Quiet>true</Quiet>')

    const response = await stub.fetch(new Request('http://do/deleteObjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, keys: objects }),
    }))

    if (!response.ok) {
      throw S3Errors.NoSuchBucket(bucket)
    }

    const result = await response.json() as {
      deleted: Array<{ key: string; versionId?: string; deleteMarker?: boolean }>
      errors: Array<{ key: string; code: string; message: string }>
    }

    if (quiet) {
      // Quiet mode - only return errors
      const errorsXml = result.errors
        .map(e => `
    <Error>
      <Key>${escapeXml(e.key)}</Key>
      <Code>${e.code}</Code>
      <Message>${escapeXml(e.message)}</Message>
    </Error>`)
        .join('')

      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${errorsXml}
</DeleteResult>`)
    }

    const deletedXml = result.deleted
      .map(d => `
    <Deleted>
      <Key>${escapeXml(d.key)}</Key>
      ${d.versionId ? `<VersionId>${d.versionId}</VersionId>` : ''}
      ${d.deleteMarker ? '<DeleteMarker>true</DeleteMarker>' : ''}
    </Deleted>`)
      .join('')

    const errorsXml = result.errors
      .map(e => `
    <Error>
      <Key>${escapeXml(e.key)}</Key>
      <Code>${e.code}</Code>
      <Message>${escapeXml(e.message)}</Message>
    </Error>`)
      .join('')

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${deletedXml}${errorsXml}
</DeleteResult>`)
  } catch (e) {
    if (e instanceof Error && 'statusCode' in e) {
      return errorResponse(e as S3Error)
    }
    throw e
  }
}

export default s3Router
