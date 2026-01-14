/**
 * SerializationEngine Types
 * Comprehensive type definitions for the serialization system
 */

/** Supported serialization formats */
export type SerializationFormat = 'json' | 'msgpack' | 'cbor' | 'protobuf-like'

/** Options for serialization */
export interface SerializeOptions {
  /** Pretty print (for text formats) */
  pretty?: boolean
  /** Include type information for reconstruction */
  includeType?: boolean
  /** Handle circular references */
  handleCircular?: boolean
  /** Custom replacer function */
  replacer?: (key: string, value: unknown) => unknown
}

/** Options for deserialization */
export interface DeserializeOptions {
  /** Strict mode - throw on unknown types */
  strict?: boolean
  /** Custom reviver function */
  reviver?: (key: string, value: unknown) => unknown
}

/** Value with type information for reconstruction */
export interface TypedValue<T = unknown> {
  /** Type identifier */
  type: string
  /** The actual value */
  value: T
}

/** Schema definition for typed serialization */
export interface Schema {
  /** Schema name */
  name: string
  /** Field definitions */
  fields: Record<string, FieldDefinition>
}

/** Field definition within a schema */
export interface FieldDefinition {
  /** Field type */
  type: 'string' | 'number' | 'boolean' | 'date' | 'bigint' | 'buffer' | 'array' | 'object' | 'map' | 'set'
  /** Whether the field is required */
  required?: boolean
  /** For array/map/set - the element type */
  elementType?: FieldDefinition
  /** For object - nested schema */
  schema?: Schema
}

/** Custom serializer interface */
export interface CustomSerializer<T = unknown> {
  /** Serialize value to bytes or string */
  serialize(value: T, options?: SerializeOptions): Uint8Array | string
  /** Deserialize bytes or string to value */
  deserialize(data: Uint8Array | string, options?: DeserializeOptions): T
}

/** Result of serialization */
export interface SerializationResult {
  /** Serialized data */
  data: Uint8Array | string
  /** Size in bytes */
  size: number
  /** Format used */
  format: SerializationFormat | string
}

/** Stream chunk for streaming serialization */
export interface StreamChunk {
  /** Chunk data */
  data: Uint8Array | string
  /** Whether this is the final chunk */
  final: boolean
  /** Chunk index */
  index: number
}

/** Compression options */
export interface CompressionOptions {
  /** Compression algorithm */
  algorithm: 'gzip' | 'deflate' | 'none'
  /** Compression level (1-9) */
  level?: number
}
