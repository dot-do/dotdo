# BlobStore

> Binary object storage with R2 as primary tier

## Overview

BlobStore provides optimized storage for binary objects (files, images, PDFs, artifacts). Unlike other store primitives, BlobStore uses R2 as its primary storage rather than DO SQLite, since SQLite has blob size limits and binary data doesn't benefit from relational operations.

## Features

- **Binary storage** - Store any binary content (images, PDFs, videos, etc.)
- **Streaming upload/download** - Efficient large file handling
- **Content-addressed** - Optional SHA-256 deduplication
- **Metadata index** - SQLite index for fast lookups
- **Presigned URLs** - Secure direct browser uploads/downloads
- **CDC integration** - Metadata changes emit events
- **Three-tier storage** - Metadata hot, blobs warm/cold

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite (Metadata Only)                                  │
│ • Blob metadata (id, content-type, size, hash, timestamps)      │
│ • Index for fast lookups by type, size, date                    │
│ • Reference counts for deduplication                            │
│ • NO binary content stored in SQLite                            │
│ Access: <1ms for metadata                                       │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Standard (Primary Blob Storage)                        │
│ • All binary content stored in R2                               │
│ • Content-addressed paths: blobs/{sha256-prefix}/{sha256}       │
│ • Or key-addressed: blobs/{namespace}/{key}                     │
│ • Multipart upload for large files                              │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Infrequent Access                                      │
│ • Blobs not accessed in 30+ days                                │
│ • Automatic lifecycle transition                                │
│ • Same access patterns, lower cost                              │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why R2 Primary?

Unlike other primitives, BlobStore doesn't use SQLite for primary storage:

| Factor | SQLite | R2 |
|--------|--------|-----|
| Max blob size | ~1GB (practical ~100MB) | 5TB |
| Streaming | No | Yes |
| Direct browser access | No | Presigned URLs |
| Cost per GB | Higher (DO compute) | Lower ($0.015/GB) |
| Binary operations | None | Native |

## API

```typescript
import { BlobStore } from 'dotdo/db/blob'

const blobs = new BlobStore(env.R2_BUCKET, db)

// Upload blob
const blob = await blobs.put({
  key: 'uploads/avatar.png',
  data: imageBuffer,  // ArrayBuffer, ReadableStream, or Blob
  contentType: 'image/png',
  metadata: { userId: 'user_123', purpose: 'avatar' }
})
// Returns: { $id, key, size, hash, contentType, url }

// Upload with streaming (large files)
const stream = request.body
const blob = await blobs.putStream({
  key: 'uploads/video.mp4',
  stream,
  contentType: 'video/mp4',
  contentLength: parseInt(request.headers.get('content-length') || '0')
})

// Download blob
const data = await blobs.get('uploads/avatar.png')
// Returns: { data: ArrayBuffer, metadata: {...} }

// Download as stream
const stream = await blobs.getStream('uploads/video.mp4')
// Returns: ReadableStream

// Get presigned URL for direct browser access
const url = await blobs.getSignedUrl('uploads/avatar.png', {
  expiresIn: '1h',
  disposition: 'inline',  // or 'attachment'
})

// Get presigned upload URL (browser direct upload)
const uploadUrl = await blobs.getUploadUrl({
  key: 'uploads/user-upload.pdf',
  contentType: 'application/pdf',
  maxSize: 10 * 1024 * 1024,  // 10MB
  expiresIn: '15m',
})

// Delete blob
await blobs.delete('uploads/avatar.png')

// List blobs
const list = await blobs.list({
  prefix: 'uploads/',
  limit: 100,
  cursor: previousCursor,
})

// Query by metadata
const avatars = await blobs.query({
  where: { 'metadata.purpose': 'avatar' },
  limit: 10,
})
```

## Content-Addressed Storage

Enable deduplication with content-addressed mode:

```typescript
const blobs = new BlobStore(env.R2_BUCKET, db, {
  contentAddressed: true,  // Store by SHA-256 hash
})

// Same content = same storage location
await blobs.put({ key: 'file1.pdf', data: pdfBuffer })
await blobs.put({ key: 'file2.pdf', data: pdfBuffer })  // Same content
// Only one copy stored, two metadata entries pointing to it

// Reference counting for safe deletion
await blobs.delete('file1.pdf')  // Decrements ref count
await blobs.delete('file2.pdf')  // Ref count = 0, blob deleted
```

## Schema (Metadata Index)

```sql
-- Blob metadata (hot tier - SQLite)
CREATE TABLE blobs (
  $id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,           -- Actual R2 object key
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,                       -- SHA-256 for dedup
  ref_count INTEGER DEFAULT 1,    -- For content-addressed
  metadata JSON,
  $createdAt INTEGER NOT NULL,
  $updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_blobs_prefix ON blobs(key);
CREATE INDEX idx_blobs_type ON blobs(content_type);
CREATE INDEX idx_blobs_hash ON blobs(hash);
CREATE INDEX idx_blobs_size ON blobs(size);
```

## R2 Lifecycle Rules

```typescript
// Automatic cold tier transition
const lifecycleRules = {
  rules: [
    {
      id: 'move-to-infrequent',
      condition: {
        ageInDays: 30,
        prefixMatch: 'blobs/',
      },
      action: {
        type: 'SetStorageClass',
        storageClass: 'InfrequentAccess',
      },
    },
    {
      id: 'delete-temp',
      condition: {
        ageInDays: 1,
        prefixMatch: 'temp/',
      },
      action: {
        type: 'Delete',
      },
    },
  ],
}
```

## CDC Events

```typescript
// On upload
{
  type: 'cdc.insert',
  op: 'c',
  store: 'blob',
  table: 'blobs',
  key: 'uploads/avatar.png',
  after: {
    size: 102400,
    contentType: 'image/png',
    hash: 'sha256:abc123...',
    metadata: { userId: 'user_123' }
  }
}

// On delete
{
  type: 'cdc.delete',
  op: 'd',
  store: 'blob',
  table: 'blobs',
  key: 'uploads/avatar.png',
  before: { ... }
}
```

## When to Use

| Use BlobStore | Use DocumentStore |
|---------------|-------------------|
| Binary files (images, PDFs) | JSON data |
| Large objects (>1MB) | Small structured data |
| User uploads | Application state |
| Artifacts, exports | Entity records |

## Dependencies

- Cloudflare R2 bucket binding

## Related

- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Implementation Status

| Feature | Status |
|---------|--------|
| Basic put/get | TBD |
| Streaming upload/download | TBD |
| Presigned URLs | TBD |
| Content-addressed dedup | TBD |
| Metadata index | TBD |
| Query by metadata | TBD |
| Lifecycle rules | TBD |
| CDC integration | TBD |
