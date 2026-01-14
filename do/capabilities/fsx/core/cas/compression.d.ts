/**
 * Zlib compression utilities for Content-Addressable Storage
 *
 * Uses the zlib format (RFC 1950) which is:
 * - CMF byte (usually 0x78 for deflate with 32K window)
 * - FLG byte (determines compression level)
 * - Compressed data (deflate algorithm)
 * - ADLER-32 checksum (4 bytes)
 *
 * This format is compatible with git's object storage.
 */
/**
 * Compress data using zlib deflate format
 *
 * @param data - The data to compress
 * @returns Compressed data in zlib format (header + deflate + adler32)
 */
export declare function compress(data: Uint8Array): Promise<Uint8Array>;
/**
 * Decompress zlib deflate format data
 *
 * @param data - The compressed data in zlib format
 * @returns Decompressed original data
 * @throws Error if data is invalid, corrupted, or truncated
 */
export declare function decompress(data: Uint8Array): Promise<Uint8Array>;
//# sourceMappingURL=compression.d.ts.map