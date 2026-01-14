/**
 * Gzip decompression for npm tarballs
 *
 * npm packages are distributed as gzipped tarballs (.tgz)
 */

import { GZIP_MAGIC } from './types'
import { TarballError } from '../errors'

/**
 * Decompress gzip data
 *
 * @param data - Gzipped data
 * @returns Decompressed data
 * @throws Error if data is not valid gzip
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  // Check for gzip magic bytes
  if (data.length < 10) {
    throw new TarballError('Invalid gzip data: too short')
  }

  if (data[0] !== GZIP_MAGIC[0] || data[1] !== GZIP_MAGIC[1]) {
    throw new TarballError('Invalid gzip data: missing magic bytes')
  }

  try {
    // Use DecompressionStream API (available in modern runtimes)
    const ds = new DecompressionStream('gzip')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })

    const decompressedStream = stream.pipeThrough(ds)
    const reader = decompressedStream.getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }

    // Combine chunks into a single Uint8Array
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new TarballError(`Failed to decompress gzip data: ${message}`)
  }
}

/**
 * Check if data is gzip compressed
 *
 * @param data - Data to check
 * @returns true if data appears to be gzip compressed
 */
export function isGzipData(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1]
}

/**
 * Compress data using gzip
 *
 * @param data - Data to compress
 * @returns Gzipped data
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  try {
    const cs = new CompressionStream('gzip')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })

    const compressedStream = stream.pipeThrough(cs)
    const reader = compressedStream.getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }

    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new TarballError(`Failed to compress data: ${message}`)
  }
}
