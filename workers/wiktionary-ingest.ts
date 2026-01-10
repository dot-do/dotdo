/**
 * @dotdo/workers/wiktionary-ingest - Wiktionary Data Ingest Worker
 *
 * Streams Wiktionary data from kaikki.org and stores it in R2 buckets,
 * partitioned by first letter of word (a.jsonl, b.jsonl, ..., z.jsonl).
 *
 * Source: https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz
 *
 * Features:
 * - Streaming decompression with DecompressionStream
 * - Line-by-line processing (never holds full file in memory)
 * - Alphabet partitioning for efficient queue processing
 * - Handles non-alphabetic words in _other.jsonl
 * - Chunk-based R2 writes to avoid memory bloat (no read-modify-write)
 *
 * Memory constraints:
 * - Worker limit: 128MB
 * - Uses streaming throughout to stay well under limit
 * - Flushes partitions periodically to avoid buffer bloat
 * - Writes chunks directly, then merges via multipart upload
 *
 * @module workers/wiktionary-ingest
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Worker environment bindings
 */
export interface Env {
  /**
   * R2 bucket for dictionary data
   */
  DICTIONARY_BUCKET: R2Bucket

  /**
   * Optional: prefix for stored objects
   */
  R2_PREFIX?: string

  /**
   * Debug mode
   */
  DEBUG?: string
}

/**
 * Wiktionary entry from kaikki.org JSONL
 */
interface WiktionaryEntry {
  word: string
  pos?: string
  senses?: Array<{
    glosses?: string[]
    raw_glosses?: string[]
    tags?: string[]
    examples?: Array<{
      text?: string
      ref?: string
    }>
  }>
  etymology_text?: string
  sounds?: Array<{
    ipa?: string
    audio?: string
  }>
  forms?: Array<{
    form?: string
    tags?: string[]
  }>
  [key: string]: unknown
}

/**
 * Ingest statistics
 */
interface IngestStats {
  totalLines: number
  parsedEntries: number
  parseErrors: number
  partitions: Record<string, number>
  bytesRead: number
  bytesWritten: number
  durationMs: number
}

// ============================================================================
// CONSTANTS
// ============================================================================

const KAIKKI_URL = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz'

/**
 * Maximum buffer size per partition before flushing (in bytes)
 *
 * Memory budget: 128MB worker limit
 * - 27 partitions (a-z + _other)
 * - Target: ~3-4MB per partition buffer = ~80-100MB max
 * - Chunks are merged at the end using streaming concatenation
 */
const MAX_PARTITION_BUFFER_BYTES = 3 * 1024 * 1024 // 3MB per partition

/**
 * R2 multipart minimum part size (except last part)
 */
const R2_MULTIPART_MIN_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Maximum lines to buffer before considering a flush
 */
const MAX_LINES_BEFORE_FLUSH = 10000

// ============================================================================
// PARTITION MANAGER
// ============================================================================

/**
 * Manages alphabet partitions and their buffers
 *
 * Writes chunks to separate temporary objects (e.g., a.chunk.000.jsonl),
 * then merges them into final files at the end. This avoids read-modify-write
 * patterns that would cause memory issues with large files.
 */
class PartitionManager {
  private buffers: Map<string, string[]> = new Map()
  private bufferSizes: Map<string, number> = new Map()
  private chunkCounts: Map<string, number> = new Map()
  private bucket: R2Bucket
  private prefix: string
  private debug: boolean
  private totalEntries: Record<string, number> = {}
  private bytesWritten = 0
  private ingestId: string

  constructor(bucket: R2Bucket, prefix: string = '', debug: boolean = false) {
    this.bucket = bucket
    this.prefix = prefix
    this.debug = debug
    // Unique ID for this ingest run to avoid conflicts
    this.ingestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    // Initialize all partitions
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i) // a-z
      this.buffers.set(letter, [])
      this.bufferSizes.set(letter, 0)
      this.chunkCounts.set(letter, 0)
      this.totalEntries[letter] = 0
    }
    this.buffers.set('_other', [])
    this.bufferSizes.set('_other', 0)
    this.chunkCounts.set('_other', 0)
    this.totalEntries['_other'] = 0
  }

  /**
   * Get partition key for a word
   */
  private getPartitionKey(word: string): string {
    if (!word || word.length === 0) return '_other'

    const firstChar = word.charAt(0).toLowerCase()
    if (firstChar >= 'a' && firstChar <= 'z') {
      return firstChar
    }
    return '_other'
  }

  /**
   * Add an entry to the appropriate partition
   */
  add(entry: WiktionaryEntry): void {
    const key = this.getPartitionKey(entry.word)
    const line = JSON.stringify(entry) + '\n'

    const buffer = this.buffers.get(key)!
    buffer.push(line)

    const currentSize = this.bufferSizes.get(key)!
    this.bufferSizes.set(key, currentSize + line.length)
  }

  /**
   * Check if any partition needs flushing
   */
  needsFlush(): boolean {
    for (const size of this.bufferSizes.values()) {
      if (size >= MAX_PARTITION_BUFFER_BYTES) {
        return true
      }
    }
    return false
  }

  /**
   * Flush partitions that exceed the buffer limit
   */
  async flushIfNeeded(): Promise<void> {
    const flushPromises: Promise<void>[] = []

    for (const [key, size] of this.bufferSizes.entries()) {
      if (size >= MAX_PARTITION_BUFFER_BYTES) {
        flushPromises.push(this.flushPartitionChunk(key))
      }
    }

    await Promise.all(flushPromises)
  }

  /**
   * Flush a single partition buffer to a chunk file
   */
  private async flushPartitionChunk(key: string): Promise<void> {
    const buffer = this.buffers.get(key)!
    if (buffer.length === 0) return

    const content = buffer.join('')
    const chunkNum = this.chunkCounts.get(key)!
    const chunkKey = `${this.prefix}chunks/${this.ingestId}/${key}.${chunkNum.toString().padStart(4, '0')}.jsonl`

    await this.bucket.put(chunkKey, content, {
      httpMetadata: {
        contentType: 'application/x-ndjson',
      },
      customMetadata: {
        partition: key,
        chunk: chunkNum.toString(),
        ingestId: this.ingestId,
      },
    })

    this.bytesWritten += content.length
    this.totalEntries[key] += buffer.length
    this.chunkCounts.set(key, chunkNum + 1)

    if (this.debug) {
      console.log(`[wiktionary-ingest] Wrote chunk ${chunkKey} (${buffer.length} entries)`)
    }

    // Clear buffer
    this.buffers.set(key, [])
    this.bufferSizes.set(key, 0)
  }

  /**
   * Flush all remaining buffers and merge chunks into final files
   */
  async flushAll(): Promise<void> {
    // Flush any remaining buffered data
    const flushPromises: Promise<void>[] = []
    for (const key of this.buffers.keys()) {
      if (this.buffers.get(key)!.length > 0) {
        flushPromises.push(this.flushPartitionChunk(key))
      }
    }
    await Promise.all(flushPromises)

    // Merge chunks into final files
    await this.mergeChunks()
  }

  /**
   * Merge all chunks for each partition into final files
   *
   * Strategy:
   * 1. Single chunk: Stream directly to final file
   * 2. Multiple small chunks: Read-concatenate (fits in memory since chunks are small)
   * 3. Many chunks totaling > threshold: Use R2 multipart with combined parts
   */
  private async mergeChunks(): Promise<void> {
    const partitionKeys = Array.from(this.buffers.keys())

    for (const key of partitionKeys) {
      const chunkCount = this.chunkCounts.get(key)!
      if (chunkCount === 0) continue

      const finalKey = `${this.prefix}${key}.jsonl`

      if (chunkCount === 1) {
        // Single chunk - stream directly to final file
        const chunkKey = `${this.prefix}chunks/${this.ingestId}/${key}.0000.jsonl`
        const chunk = await this.bucket.get(chunkKey)
        if (chunk) {
          await this.bucket.put(finalKey, chunk.body, {
            httpMetadata: {
              contentType: 'application/x-ndjson',
            },
            customMetadata: {
              partition: key,
              entries: this.totalEntries[key].toString(),
              ingestId: this.ingestId,
              completedAt: new Date().toISOString(),
            },
          })
          await this.bucket.delete(chunkKey)
        }
      } else {
        // Multiple chunks - concatenate with streaming
        // For efficiency, we use a TransformStream to pipe chunks together
        await this.mergeMultipleChunks(key, chunkCount, finalKey)
      }

      if (this.debug) {
        console.log(`[wiktionary-ingest] Merged ${chunkCount} chunks into ${finalKey}`)
      }
    }
  }

  /**
   * Merge multiple chunks into a single file using R2 multipart upload
   * Combines small chunks to meet the 5MB minimum part size requirement
   */
  private async mergeMultipleChunks(
    key: string,
    chunkCount: number,
    finalKey: string
  ): Promise<void> {
    const multipart = await this.bucket.createMultipartUpload(finalKey, {
      httpMetadata: {
        contentType: 'application/x-ndjson',
      },
      customMetadata: {
        partition: key,
        entries: this.totalEntries[key].toString(),
        ingestId: this.ingestId,
        completedAt: new Date().toISOString(),
      },
    })

    const parts: R2UploadedPart[] = []
    const chunkKeysToDelete: string[] = []

    // Buffer to combine small chunks until we reach 5MB minimum
    let combinedBuffer: Uint8Array[] = []
    let combinedSize = 0

    const flushCombined = async (isLast: boolean) => {
      if (combinedBuffer.length === 0) return

      // Combine buffers
      const totalSize = combinedBuffer.reduce((sum, buf) => sum + buf.length, 0)
      const combined = new Uint8Array(totalSize)
      let offset = 0
      for (const buf of combinedBuffer) {
        combined.set(buf, offset)
        offset += buf.length
      }

      // Only check minimum size if not the last part
      if (!isLast && combined.length < R2_MULTIPART_MIN_SIZE) {
        // Keep buffering
        return false
      }

      const partNumber = parts.length + 1
      const part = await multipart.uploadPart(partNumber, combined)
      parts.push(part)

      combinedBuffer = []
      combinedSize = 0
      return true
    }

    try {
      for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `${this.prefix}chunks/${this.ingestId}/${key}.${i.toString().padStart(4, '0')}.jsonl`
        const chunk = await this.bucket.get(chunkKey)

        if (chunk && chunk.body) {
          const body = new Uint8Array(await chunk.arrayBuffer())
          combinedBuffer.push(body)
          combinedSize += body.length
          chunkKeysToDelete.push(chunkKey)

          // Try to flush if we have enough data
          if (combinedSize >= R2_MULTIPART_MIN_SIZE) {
            await flushCombined(false)
          }
        }
      }

      // Flush any remaining data as the last part
      await flushCombined(true)

      if (parts.length > 0) {
        await multipart.complete(parts)

        // Clean up chunk files
        for (const chunkKey of chunkKeysToDelete) {
          await this.bucket.delete(chunkKey)
        }
      } else {
        await multipart.abort()
      }
    } catch (error) {
      await multipart.abort()
      throw error
    }
  }

  /**
   * Get statistics
   */
  getStats(): { partitions: Record<string, number>; bytesWritten: number } {
    // Add current buffer counts to written counts
    const partitions: Record<string, number> = {}
    for (const [key, count] of Object.entries(this.totalEntries)) {
      partitions[key] = count + (this.buffers.get(key)?.length ?? 0)
    }

    return {
      partitions,
      bytesWritten: this.bytesWritten,
    }
  }
}

// ============================================================================
// STREAMING UTILITIES
// ============================================================================

/**
 * Transform stream that splits input into lines
 */
class LineSplitter extends TransformStream<Uint8Array, string> {
  constructor() {
    let buffer = ''
    const decoder = new TextDecoder()

    super({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })

        const lines = buffer.split('\n')
        // Keep the last incomplete line in buffer
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.trim()) {
            controller.enqueue(line)
          }
        }
      },

      flush(controller) {
        // Handle any remaining content
        if (buffer.trim()) {
          controller.enqueue(buffer)
        }
      },
    })
  }
}

// ============================================================================
// MAIN INGEST FUNCTION
// ============================================================================

/**
 * Stream and ingest Wiktionary data
 */
async function ingestWiktionary(
  env: Env,
  sourceUrl: string = KAIKKI_URL
): Promise<IngestStats> {
  const startTime = Date.now()
  const debug = env.DEBUG === 'true'
  const prefix = env.R2_PREFIX || 'wiktionary/english/'

  if (debug) {
    console.log(`[wiktionary-ingest] Starting ingest from ${sourceUrl}`)
  }

  // Fetch the gzipped JSONL file
  const response = await fetch(sourceUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('Response body is null')
  }

  // Create partition manager
  const partitionManager = new PartitionManager(env.DICTIONARY_BUCKET, prefix, debug)

  // Stats tracking
  let totalLines = 0
  let parsedEntries = 0
  let parseErrors = 0
  let bytesRead = 0

  // Decompress -> Split into lines -> Process
  const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'))
  const lines = decompressed.pipeThrough(new LineSplitter())

  const reader = lines.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      totalLines++
      bytesRead += value.length

      try {
        const entry = JSON.parse(value) as WiktionaryEntry

        if (entry.word) {
          partitionManager.add(entry)
          parsedEntries++
        } else {
          parseErrors++
          if (debug) {
            console.warn(`[wiktionary-ingest] Entry missing 'word' field at line ${totalLines}`)
          }
        }
      } catch (e) {
        parseErrors++
        if (debug && parseErrors <= 10) {
          console.warn(`[wiktionary-ingest] Parse error at line ${totalLines}:`, e)
        }
      }

      // Periodic flush to avoid memory pressure
      if (totalLines % MAX_LINES_BEFORE_FLUSH === 0) {
        await partitionManager.flushIfNeeded()

        if (debug && totalLines % 100000 === 0) {
          console.log(`[wiktionary-ingest] Processed ${totalLines} lines...`)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Final flush
  await partitionManager.flushAll()

  const stats = partitionManager.getStats()
  const durationMs = Date.now() - startTime

  if (debug) {
    console.log(`[wiktionary-ingest] Complete: ${parsedEntries} entries in ${durationMs}ms`)
  }

  return {
    totalLines,
    parsedEntries,
    parseErrors,
    partitions: stats.partitions,
    bytesRead,
    bytesWritten: stats.bytesWritten,
    durationMs,
  }
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        service: 'wiktionary-ingest',
        source: KAIKKI_URL,
        endpoints: [
          { path: '/', method: 'GET', description: 'Health check' },
          { path: '/ingest', method: 'POST', description: 'Start full ingest' },
          { path: '/list', method: 'GET', description: 'List ingested partitions' },
        ],
      })
    }

    // List ingested partitions
    if (url.pathname === '/list' && request.method === 'GET') {
      const prefix = env.R2_PREFIX || 'wiktionary/english/'
      const list = await env.DICTIONARY_BUCKET.list({ prefix })

      const partitions = list.objects.map(obj => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded.toISOString(),
      }))

      return Response.json({
        prefix,
        partitions,
        count: partitions.length,
      })
    }

    // Start ingest
    if (url.pathname === '/ingest' && request.method === 'POST') {
      try {
        // Optional: custom source URL from request body
        let sourceUrl = KAIKKI_URL
        if (request.headers.get('content-type')?.includes('application/json')) {
          const body = await request.json() as { url?: string }
          if (body.url) {
            sourceUrl = body.url
          }
        }

        const stats = await ingestWiktionary(env, sourceUrl)

        return Response.json({
          status: 'complete',
          stats,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json(
          {
            status: 'error',
            error: message,
          },
          { status: 500 }
        )
      }
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404 }
    )
  },

  /**
   * Handle scheduled events (cron triggers)
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const debug = env.DEBUG === 'true'

    if (debug) {
      console.log(`[wiktionary-ingest] Scheduled ingest triggered at ${new Date().toISOString()}`)
    }

    ctx.waitUntil(
      ingestWiktionary(env)
        .then(stats => {
          console.log(`[wiktionary-ingest] Scheduled ingest complete:`, stats)
        })
        .catch(error => {
          console.error(`[wiktionary-ingest] Scheduled ingest failed:`, error)
        })
    )
  },
}
