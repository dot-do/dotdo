/**
 * Hash computation functions using the Web Crypto API (crypto.subtle)
 *
 * These functions compute cryptographic hashes for content-addressable storage.
 * They return lowercase hex-encoded strings.
 */
/**
 * Convert a Uint8Array to a hexadecimal string.
 *
 * Uses a pre-computed lookup table for O(1) byte-to-hex conversion,
 * making this significantly faster than string formatting approaches.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * const hello = new TextEncoder().encode('Hello')
 * const hex = bytesToHex(hello)
 * console.log(hex) // '48656c6c6f'
 * ```
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Convert a hexadecimal string to a Uint8Array.
 *
 * @param hex - Hexadecimal string (case-insensitive)
 * @returns Binary data as Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = hexToBytes('48656c6c6f')
 * console.log(new TextDecoder().decode(bytes)) // 'Hello'
 * ```
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Compute SHA-1 hash of data
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 40-character lowercase hex string
 */
export declare function sha1(data: Uint8Array | string): Promise<string>;
/**
 * Compute SHA-256 hash of data
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 64-character lowercase hex string
 */
export declare function sha256(data: Uint8Array | string): Promise<string>;
//# sourceMappingURL=hash.d.ts.map