/**
 * SerializationEngine
 * Comprehensive serialization system with support for multiple formats,
 * special types, streaming, and compression.
 */

import type {
  SerializationFormat,
  SerializeOptions,
  DeserializeOptions,
  CustomSerializer,
  SerializationResult,
  StreamChunk,
  CompressionOptions,
  Schema,
  TypedValue,
} from './types'

// Re-export types
export * from './types'

/** Type markers for special type serialization */
const TYPE_MARKERS = {
  DATE: '__$date',
  BIGINT: '__$bigint',
  MAP: '__$map',
  SET: '__$set',
  BUFFER: '__$buffer',
  UNDEFINED: '__$undefined',
  CIRCULAR: '__$circular',
} as const

/** Circular reference marker */
const CIRCULAR_REF = '__$ref'

/** Sentinel value for undefined during parsing */
const UNDEFINED_SENTINEL = Symbol('undefined')

/** Combine multiple Uint8Array chunks into a single array */
function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * JSON Serializer with support for special types
 */
export class JSONSerializer implements CustomSerializer {
  serialize(value: unknown, options?: SerializeOptions): string {
    const seen = new Map<object, string>()
    let pathCounter = 0

    // Pre-process to handle undefined values (JSON.stringify removes them before replacer)
    const preProcess = (val: unknown): unknown => {
      if (val === undefined && options?.includeType) {
        return { [TYPE_MARKERS.UNDEFINED]: true }
      }

      if (val instanceof Date) {
        return options?.includeType
          ? { [TYPE_MARKERS.DATE]: val.toISOString() }
          : val.toISOString()
      }

      if (typeof val === 'bigint') {
        return options?.includeType
          ? { [TYPE_MARKERS.BIGINT]: val.toString() }
          : val.toString()
      }

      if (val instanceof Map) {
        const entries = Array.from(val.entries()).map(([k, v]) => [k, preProcess(v)])
        return options?.includeType
          ? { [TYPE_MARKERS.MAP]: entries }
          : Object.fromEntries(entries)
      }

      if (val instanceof Set) {
        const items = Array.from(val).map(v => preProcess(v))
        return options?.includeType
          ? { [TYPE_MARKERS.SET]: items }
          : items
      }

      if (val instanceof Uint8Array) {
        return options?.includeType
          ? { [TYPE_MARKERS.BUFFER]: Array.from(val) }
          : Array.from(val)
      }

      if (Array.isArray(val)) {
        return val.map(v => preProcess(v))
      }

      if (val !== null && typeof val === 'object') {
        // Check circular references
        if (seen.has(val)) {
          if (options?.handleCircular) {
            return { [CIRCULAR_REF]: seen.get(val) }
          }
          throw new TypeError('Converting circular structure to JSON')
        }
        const path = `$${pathCounter++}`
        seen.set(val, path)

        const result: Record<string, unknown> = {}
        if (options?.handleCircular) {
          result.__$path = path
        }

        for (const key of Object.keys(val as Record<string, unknown>)) {
          const propVal = (val as Record<string, unknown>)[key]
          result[key] = preProcess(propVal)
        }
        return result
      }

      return val
    }

    const replacer = (key: string, val: unknown): unknown => {
      // Apply custom replacer
      if (options?.replacer) {
        val = options.replacer(key, val)
      }
      return val
    }

    const processed = preProcess(value)
    const space = options?.pretty ? 2 : undefined
    return JSON.stringify(processed, options?.replacer ? replacer : undefined, space)
  }

  deserialize(data: Uint8Array | string, options?: DeserializeOptions): any {
    const str = data instanceof Uint8Array ? new TextDecoder().decode(data) : data
    const refs = new Map<string, any>()

    const reviver = (key: string, val: unknown): unknown => {
      if (val !== null && typeof val === 'object') {
        const obj = val as Record<string, unknown>

        // Store reference for circular reconstruction
        if (obj.__$path) {
          refs.set(obj.__$path as string, obj)
          delete obj.__$path
        }

        // Handle circular reference
        if (CIRCULAR_REF in obj) {
          const refPath = obj[CIRCULAR_REF] as string
          return refs.get(refPath) ?? obj
        }

        // Check for strict mode with unknown types
        if (options?.strict && obj.__type && !Object.values(TYPE_MARKERS).some(m => m in obj)) {
          throw new Error(`Unknown type: ${obj.__type}`)
        }

        if (TYPE_MARKERS.DATE in obj) {
          return new Date(obj[TYPE_MARKERS.DATE] as string)
        }

        if (TYPE_MARKERS.BIGINT in obj) {
          return BigInt(obj[TYPE_MARKERS.BIGINT] as string)
        }

        if (TYPE_MARKERS.MAP in obj) {
          return new Map(obj[TYPE_MARKERS.MAP] as [unknown, unknown][])
        }

        if (TYPE_MARKERS.SET in obj) {
          return new Set(obj[TYPE_MARKERS.SET] as unknown[])
        }

        if (TYPE_MARKERS.BUFFER in obj) {
          return new Uint8Array(obj[TYPE_MARKERS.BUFFER] as number[])
        }

        if (TYPE_MARKERS.UNDEFINED in obj) {
          // Return sentinel - we'll convert to undefined in post-processing
          return UNDEFINED_SENTINEL
        }
      }

      // Apply custom reviver
      if (options?.reviver) {
        return options.reviver(key, val)
      }

      return val
    }

    const result = JSON.parse(str, reviver)

    // Post-process to resolve circular references and undefined sentinels
    const postProcess = (obj: any, root: any): any => {
      if (obj === null || typeof obj !== 'object') return obj

      for (const key of Object.keys(obj)) {
        const val = obj[key]

        // Convert sentinel back to undefined
        if (val === UNDEFINED_SENTINEL) {
          obj[key] = undefined
          continue
        }

        if (val !== null && typeof val === 'object') {
          if (CIRCULAR_REF in val) {
            obj[key] = root
          } else {
            postProcess(val, root)
          }
        }
      }
      return obj
    }

    if (typeof result === 'object' && result !== null) {
      postProcess(result, result)
    }

    return result
  }
}

/**
 * MsgPack-like binary serializer
 * Implements a simplified MessagePack-inspired format
 */
export class MsgPackSerializer implements CustomSerializer {
  private static readonly TYPES = {
    NULL: 0xc0,
    FALSE: 0xc2,
    TRUE: 0xc3,
    FLOAT64: 0xcb,
    UINT8: 0xcc,
    UINT16: 0xcd,
    UINT32: 0xce,
    INT8: 0xd0,
    INT16: 0xd1,
    INT32: 0xd2,
    STR8: 0xd9,
    STR16: 0xda,
    STR32: 0xdb,
    ARRAY16: 0xdc,
    ARRAY32: 0xdd,
    MAP16: 0xde,
    MAP32: 0xdf,
    FIXSTR_BASE: 0xa0,
    FIXARRAY_BASE: 0x90,
    FIXMAP_BASE: 0x80,
    POSITIVE_FIXINT_MAX: 0x7f,
    NEGATIVE_FIXINT_BASE: 0xe0,
  } as const

  serialize(value: unknown, _options?: SerializeOptions): Uint8Array {
    const chunks: number[] = []
    this.encodeValue(value, chunks)
    return new Uint8Array(chunks)
  }

  private encodeValue(value: unknown, out: number[]): void {
    if (value === null) {
      out.push(MsgPackSerializer.TYPES.NULL)
      return
    }

    if (value === undefined) {
      out.push(MsgPackSerializer.TYPES.NULL)
      return
    }

    if (typeof value === 'boolean') {
      out.push(value ? MsgPackSerializer.TYPES.TRUE : MsgPackSerializer.TYPES.FALSE)
      return
    }

    if (typeof value === 'number') {
      this.encodeNumber(value, out)
      return
    }

    if (typeof value === 'string') {
      this.encodeString(value, out)
      return
    }

    if (Array.isArray(value)) {
      this.encodeArray(value, out)
      return
    }

    if (typeof value === 'object') {
      this.encodeObject(value as Record<string, unknown>, out)
      return
    }
  }

  private encodeNumber(num: number, out: number[]): void {
    if (Number.isInteger(num)) {
      if (num >= 0 && num <= MsgPackSerializer.TYPES.POSITIVE_FIXINT_MAX) {
        out.push(num)
      } else if (num < 0 && num >= -32) {
        out.push(MsgPackSerializer.TYPES.NEGATIVE_FIXINT_BASE + (num + 32))
      } else if (num >= 0 && num <= 0xff) {
        out.push(MsgPackSerializer.TYPES.UINT8, num)
      } else if (num >= 0 && num <= 0xffff) {
        out.push(MsgPackSerializer.TYPES.UINT16)
        out.push((num >> 8) & 0xff, num & 0xff)
      } else if (num >= 0 && num <= 0xffffffff) {
        out.push(MsgPackSerializer.TYPES.UINT32)
        out.push((num >> 24) & 0xff, (num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff)
      } else if (num >= -128 && num <= 127) {
        out.push(MsgPackSerializer.TYPES.INT8, num & 0xff)
      } else if (num >= -32768 && num <= 32767) {
        out.push(MsgPackSerializer.TYPES.INT16)
        out.push((num >> 8) & 0xff, num & 0xff)
      } else {
        // Fall back to float64 for large integers
        this.encodeFloat64(num, out)
      }
    } else {
      this.encodeFloat64(num, out)
    }
  }

  private encodeFloat64(num: number, out: number[]): void {
    out.push(MsgPackSerializer.TYPES.FLOAT64)
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setFloat64(0, num, false)
    for (let i = 0; i < 8; i++) {
      out.push(view.getUint8(i))
    }
  }

  private encodeString(str: string, out: number[]): void {
    const bytes = new TextEncoder().encode(str)
    const len = bytes.length

    if (len < 32) {
      out.push(MsgPackSerializer.TYPES.FIXSTR_BASE | len)
    } else if (len <= 0xff) {
      out.push(MsgPackSerializer.TYPES.STR8, len)
    } else if (len <= 0xffff) {
      out.push(MsgPackSerializer.TYPES.STR16, (len >> 8) & 0xff, len & 0xff)
    } else {
      out.push(MsgPackSerializer.TYPES.STR32)
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
    }

    for (const byte of bytes) {
      out.push(byte)
    }
  }

  private encodeArray(arr: unknown[], out: number[]): void {
    const len = arr.length

    if (len < 16) {
      out.push(MsgPackSerializer.TYPES.FIXARRAY_BASE | len)
    } else if (len <= 0xffff) {
      out.push(MsgPackSerializer.TYPES.ARRAY16, (len >> 8) & 0xff, len & 0xff)
    } else {
      out.push(MsgPackSerializer.TYPES.ARRAY32)
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
    }

    for (const item of arr) {
      this.encodeValue(item, out)
    }
  }

  private encodeObject(obj: Record<string, unknown>, out: number[]): void {
    const keys = Object.keys(obj)
    const len = keys.length

    if (len < 16) {
      out.push(MsgPackSerializer.TYPES.FIXMAP_BASE | len)
    } else if (len <= 0xffff) {
      out.push(MsgPackSerializer.TYPES.MAP16, (len >> 8) & 0xff, len & 0xff)
    } else {
      out.push(MsgPackSerializer.TYPES.MAP32)
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
    }

    for (const key of keys) {
      this.encodeString(key, out)
      this.encodeValue(obj[key], out)
    }
  }

  deserialize(data: Uint8Array | string, _options?: DeserializeOptions): any {
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
    const state = { offset: 0 }
    return this.decodeValue(bytes, state)
  }

  private decodeValue(bytes: Uint8Array, state: { offset: number }): any {
    const type = bytes[state.offset++]

    // Positive fixint (0x00 - 0x7f)
    if (type <= MsgPackSerializer.TYPES.POSITIVE_FIXINT_MAX) {
      return type
    }

    // Fixmap (0x80 - 0x8f)
    if ((type & 0xf0) === MsgPackSerializer.TYPES.FIXMAP_BASE) {
      return this.decodeMap(bytes, state, type & 0x0f)
    }

    // Fixarray (0x90 - 0x9f)
    if ((type & 0xf0) === MsgPackSerializer.TYPES.FIXARRAY_BASE) {
      return this.decodeArray(bytes, state, type & 0x0f)
    }

    // Fixstr (0xa0 - 0xbf)
    if ((type & 0xe0) === MsgPackSerializer.TYPES.FIXSTR_BASE) {
      return this.decodeString(bytes, state, type & 0x1f)
    }

    // Negative fixint (0xe0 - 0xff)
    if (type >= MsgPackSerializer.TYPES.NEGATIVE_FIXINT_BASE) {
      return type - 256
    }

    switch (type) {
      case MsgPackSerializer.TYPES.NULL:
        return null
      case MsgPackSerializer.TYPES.FALSE:
        return false
      case MsgPackSerializer.TYPES.TRUE:
        return true
      case MsgPackSerializer.TYPES.FLOAT64:
        return this.decodeFloat64(bytes, state)
      case MsgPackSerializer.TYPES.UINT8:
        return bytes[state.offset++]
      case MsgPackSerializer.TYPES.UINT16:
        return this.decodeUint16(bytes, state)
      case MsgPackSerializer.TYPES.UINT32:
        return this.decodeUint32(bytes, state)
      case MsgPackSerializer.TYPES.INT8:
        return this.decodeInt8(bytes, state)
      case MsgPackSerializer.TYPES.INT16:
        return this.decodeInt16(bytes, state)
      case MsgPackSerializer.TYPES.INT32:
        return this.decodeInt32(bytes, state)
      case MsgPackSerializer.TYPES.STR8: {
        const len = bytes[state.offset++]
        return this.decodeString(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.STR16: {
        const len = this.decodeUint16(bytes, state)
        return this.decodeString(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.STR32: {
        const len = this.decodeUint32(bytes, state)
        return this.decodeString(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.ARRAY16: {
        const len = this.decodeUint16(bytes, state)
        return this.decodeArray(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.ARRAY32: {
        const len = this.decodeUint32(bytes, state)
        return this.decodeArray(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.MAP16: {
        const len = this.decodeUint16(bytes, state)
        return this.decodeMap(bytes, state, len)
      }
      case MsgPackSerializer.TYPES.MAP32: {
        const len = this.decodeUint32(bytes, state)
        return this.decodeMap(bytes, state, len)
      }
      default:
        throw new Error(`Unknown MsgPack type: 0x${type.toString(16)}`)
    }
  }

  private decodeFloat64(bytes: Uint8Array, state: { offset: number }): number {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    for (let i = 0; i < 8; i++) {
      view.setUint8(i, bytes[state.offset++])
    }
    return view.getFloat64(0, false)
  }

  private decodeUint16(bytes: Uint8Array, state: { offset: number }): number {
    return (bytes[state.offset++] << 8) | bytes[state.offset++]
  }

  private decodeUint32(bytes: Uint8Array, state: { offset: number }): number {
    return (
      (bytes[state.offset++] << 24) |
      (bytes[state.offset++] << 16) |
      (bytes[state.offset++] << 8) |
      bytes[state.offset++]
    ) >>> 0
  }

  private decodeInt8(bytes: Uint8Array, state: { offset: number }): number {
    const val = bytes[state.offset++]
    return val >= 128 ? val - 256 : val
  }

  private decodeInt16(bytes: Uint8Array, state: { offset: number }): number {
    const val = this.decodeUint16(bytes, state)
    return val >= 0x8000 ? val - 0x10000 : val
  }

  private decodeInt32(bytes: Uint8Array, state: { offset: number }): number {
    const val = this.decodeUint32(bytes, state)
    return val >= 0x80000000 ? val - 0x100000000 : val
  }

  private decodeString(bytes: Uint8Array, state: { offset: number }, len: number): string {
    const slice = bytes.slice(state.offset, state.offset + len)
    state.offset += len
    return new TextDecoder().decode(slice)
  }

  private decodeArray(bytes: Uint8Array, state: { offset: number }, len: number): any[] {
    const arr: any[] = []
    for (let i = 0; i < len; i++) {
      arr.push(this.decodeValue(bytes, state))
    }
    return arr
  }

  private decodeMap(bytes: Uint8Array, state: { offset: number }, len: number): Record<string, any> {
    const obj: Record<string, any> = {}
    for (let i = 0; i < len; i++) {
      const key = this.decodeValue(bytes, state)
      const value = this.decodeValue(bytes, state)
      obj[key] = value
    }
    return obj
  }
}

/**
 * CBOR-like binary serializer
 * Simplified CBOR implementation
 */
export class CBORSerializer implements CustomSerializer {
  private static readonly TYPES = {
    UNSIGNED: 0,
    NEGATIVE: 1,
    BYTES: 2,
    TEXT: 3,
    ARRAY: 4,
    MAP: 5,
    TAG: 6,
    SIMPLE: 7,
  } as const

  private static readonly SIMPLE = {
    FALSE: 20,
    TRUE: 21,
    NULL: 22,
    UNDEFINED: 23,
    FLOAT16: 25,
    FLOAT32: 26,
    FLOAT64: 27,
  } as const

  serialize(value: unknown, _options?: SerializeOptions): Uint8Array {
    const chunks: number[] = []
    this.encodeValue(value, chunks)
    return new Uint8Array(chunks)
  }

  private encodeValue(value: unknown, out: number[]): void {
    if (value === null) {
      out.push((CBORSerializer.TYPES.SIMPLE << 5) | CBORSerializer.SIMPLE.NULL)
      return
    }

    if (value === undefined) {
      out.push((CBORSerializer.TYPES.SIMPLE << 5) | CBORSerializer.SIMPLE.UNDEFINED)
      return
    }

    if (typeof value === 'boolean') {
      const simple = value ? CBORSerializer.SIMPLE.TRUE : CBORSerializer.SIMPLE.FALSE
      out.push((CBORSerializer.TYPES.SIMPLE << 5) | simple)
      return
    }

    if (typeof value === 'number') {
      this.encodeNumber(value, out)
      return
    }

    if (typeof value === 'string') {
      this.encodeString(value, out)
      return
    }

    if (Array.isArray(value)) {
      this.encodeArray(value, out)
      return
    }

    if (typeof value === 'object') {
      this.encodeMap(value as Record<string, unknown>, out)
      return
    }
  }

  private encodeLength(majorType: number, len: number, out: number[]): void {
    const prefix = majorType << 5
    if (len < 24) {
      out.push(prefix | len)
    } else if (len <= 0xff) {
      out.push(prefix | 24, len)
    } else if (len <= 0xffff) {
      out.push(prefix | 25, (len >> 8) & 0xff, len & 0xff)
    } else {
      out.push(prefix | 26)
      out.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff)
    }
  }

  private encodeNumber(num: number, out: number[]): void {
    if (Number.isInteger(num) && num >= 0 && num <= Number.MAX_SAFE_INTEGER) {
      this.encodeLength(CBORSerializer.TYPES.UNSIGNED, num, out)
    } else if (Number.isInteger(num) && num < 0 && num >= -Number.MAX_SAFE_INTEGER) {
      this.encodeLength(CBORSerializer.TYPES.NEGATIVE, -1 - num, out)
    } else {
      // Float64
      out.push((CBORSerializer.TYPES.SIMPLE << 5) | CBORSerializer.SIMPLE.FLOAT64)
      const buffer = new ArrayBuffer(8)
      const view = new DataView(buffer)
      view.setFloat64(0, num, false)
      for (let i = 0; i < 8; i++) {
        out.push(view.getUint8(i))
      }
    }
  }

  private encodeString(str: string, out: number[]): void {
    const bytes = new TextEncoder().encode(str)
    this.encodeLength(CBORSerializer.TYPES.TEXT, bytes.length, out)
    for (const byte of bytes) {
      out.push(byte)
    }
  }

  private encodeArray(arr: unknown[], out: number[]): void {
    this.encodeLength(CBORSerializer.TYPES.ARRAY, arr.length, out)
    for (const item of arr) {
      this.encodeValue(item, out)
    }
  }

  private encodeMap(obj: Record<string, unknown>, out: number[]): void {
    const keys = Object.keys(obj)
    this.encodeLength(CBORSerializer.TYPES.MAP, keys.length, out)
    for (const key of keys) {
      this.encodeString(key, out)
      this.encodeValue(obj[key], out)
    }
  }

  deserialize(data: Uint8Array | string, _options?: DeserializeOptions): any {
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data)
    const state = { offset: 0 }
    return this.decodeValue(bytes, state)
  }

  private decodeValue(bytes: Uint8Array, state: { offset: number }): any {
    const initial = bytes[state.offset++]
    const majorType = initial >> 5
    const additionalInfo = initial & 0x1f

    const len = this.decodeLength(bytes, state, additionalInfo)

    switch (majorType) {
      case CBORSerializer.TYPES.UNSIGNED:
        return len
      case CBORSerializer.TYPES.NEGATIVE:
        return -1 - len
      case CBORSerializer.TYPES.BYTES:
        return this.decodeBytes(bytes, state, len)
      case CBORSerializer.TYPES.TEXT:
        return this.decodeText(bytes, state, len)
      case CBORSerializer.TYPES.ARRAY:
        return this.decodeArray(bytes, state, len)
      case CBORSerializer.TYPES.MAP:
        return this.decodeMap(bytes, state, len)
      case CBORSerializer.TYPES.SIMPLE:
        return this.decodeSimple(bytes, state, additionalInfo)
      default:
        throw new Error(`Unknown CBOR major type: ${majorType}`)
    }
  }

  private decodeLength(bytes: Uint8Array, state: { offset: number }, additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo
    if (additionalInfo === 24) return bytes[state.offset++]
    if (additionalInfo === 25) {
      return (bytes[state.offset++] << 8) | bytes[state.offset++]
    }
    if (additionalInfo === 26) {
      return (
        (bytes[state.offset++] << 24) |
        (bytes[state.offset++] << 16) |
        (bytes[state.offset++] << 8) |
        bytes[state.offset++]
      ) >>> 0
    }
    return 0
  }

  private decodeBytes(bytes: Uint8Array, state: { offset: number }, len: number): Uint8Array {
    const slice = bytes.slice(state.offset, state.offset + len)
    state.offset += len
    return slice
  }

  private decodeText(bytes: Uint8Array, state: { offset: number }, len: number): string {
    const slice = bytes.slice(state.offset, state.offset + len)
    state.offset += len
    return new TextDecoder().decode(slice)
  }

  private decodeArray(bytes: Uint8Array, state: { offset: number }, len: number): any[] {
    const arr: any[] = []
    for (let i = 0; i < len; i++) {
      arr.push(this.decodeValue(bytes, state))
    }
    return arr
  }

  private decodeMap(bytes: Uint8Array, state: { offset: number }, len: number): Record<string, any> {
    const obj: Record<string, any> = {}
    for (let i = 0; i < len; i++) {
      const key = this.decodeValue(bytes, state)
      const value = this.decodeValue(bytes, state)
      obj[key] = value
    }
    return obj
  }

  private decodeSimple(bytes: Uint8Array, state: { offset: number }, additionalInfo: number): any {
    switch (additionalInfo) {
      case CBORSerializer.SIMPLE.FALSE:
        return false
      case CBORSerializer.SIMPLE.TRUE:
        return true
      case CBORSerializer.SIMPLE.NULL:
        return null
      case CBORSerializer.SIMPLE.UNDEFINED:
        return undefined
      case CBORSerializer.SIMPLE.FLOAT64: {
        const buffer = new ArrayBuffer(8)
        const view = new DataView(buffer)
        for (let i = 0; i < 8; i++) {
          view.setUint8(i, bytes[state.offset++])
        }
        return view.getFloat64(0, false)
      }
      default:
        return null
    }
  }
}

/**
 * Type-preserving serializer
 * Maintains full type information for reconstruction
 */
export class TypedSerializer implements CustomSerializer {
  private jsonSerializer = new JSONSerializer()

  serialize(value: unknown, options?: SerializeOptions): string {
    return this.jsonSerializer.serialize(value, { ...options, includeType: true })
  }

  deserialize(data: Uint8Array | string, options?: DeserializeOptions): any {
    return this.jsonSerializer.deserialize(data, options)
  }
}

/**
 * Streaming serializer for large data
 */
export class StreamSerializer {
  private chunkSize: number

  constructor(chunkSize = 1024) {
    this.chunkSize = chunkSize
  }

  async *serializeStream(data: unknown[]): AsyncGenerator<StreamChunk> {
    const serializer = new MsgPackSerializer()
    const fullData = serializer.serialize(data)

    let index = 0
    for (let offset = 0; offset < fullData.length; offset += this.chunkSize) {
      const chunk = fullData.slice(offset, Math.min(offset + this.chunkSize, fullData.length))
      const isFinal = offset + this.chunkSize >= fullData.length
      yield {
        data: chunk,
        final: isFinal,
        index: index++,
      }
    }
  }

  async deserializeStream(data: Uint8Array): Promise<any> {
    const serializer = new MsgPackSerializer()
    return serializer.deserialize(data)
  }
}

/**
 * Compression adapter for serialized data
 */
export class CompressionAdapter {
  private options: CompressionOptions

  constructor(options: CompressionOptions) {
    this.options = options
  }

  async compress(data: Uint8Array): Promise<Uint8Array> {
    if (this.options.algorithm === 'none') {
      return data
    }
    return this.processStream(new CompressionStream(this.options.algorithm), data)
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    if (this.options.algorithm === 'none') {
      return data
    }
    return this.processStream(new DecompressionStream(this.options.algorithm), data)
  }

  private async processStream(
    stream: CompressionStream | DecompressionStream,
    data: Uint8Array
  ): Promise<Uint8Array> {
    const writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()

    writer.write(data)
    writer.close()

    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    return concatUint8Arrays(chunks)
  }
}

/**
 * Main SerializationEngine class
 */
export class SerializationEngine {
  private serializers = new Map<string, CustomSerializer>()

  constructor() {
    // Register default serializers
    this.serializers.set('json', new JSONSerializer())
    this.serializers.set('msgpack', new MsgPackSerializer())
    this.serializers.set('cbor', new CBORSerializer())
    this.serializers.set('protobuf-like', new MsgPackSerializer()) // Use msgpack as protobuf-like
  }

  /**
   * Register a custom serializer for a format
   */
  register(format: SerializationFormat | string, serializer: CustomSerializer): void {
    this.serializers.set(format, serializer)
  }

  /**
   * Serialize data to a specific format
   */
  serialize(data: unknown, format: SerializationFormat | string, options?: SerializeOptions): SerializationResult {
    const serializer = this.serializers.get(format)
    if (!serializer) {
      throw new Error(`Unknown serialization format: ${format}`)
    }

    const result = serializer.serialize(data, options)
    const size = result instanceof Uint8Array ? result.length : new TextEncoder().encode(result).length

    return {
      data: result,
      size,
      format,
    }
  }

  /**
   * Deserialize data from a specific format
   */
  deserialize(data: Uint8Array | string, format: SerializationFormat | string, options?: DeserializeOptions): any {
    const serializer = this.serializers.get(format)
    if (!serializer) {
      throw new Error(`Unknown serialization format: ${format}`)
    }

    return serializer.deserialize(data, options)
  }

  /**
   * Convert data between formats
   */
  convert(
    data: Uint8Array | string,
    fromFormat: SerializationFormat | string,
    toFormat: SerializationFormat | string,
    options?: SerializeOptions
  ): SerializationResult {
    const parsed = this.deserialize(data, fromFormat)
    return this.serialize(parsed, toFormat, options)
  }

  /**
   * Serialize with schema validation
   */
  serializeWithSchema(
    data: unknown,
    schema: Schema,
    format: SerializationFormat | string,
    options?: SerializeOptions
  ): SerializationResult {
    this.validateSchema(data, schema)
    return this.serialize(data, format, options)
  }

  /**
   * Validate data against a schema
   */
  private validateSchema(data: unknown, schema: Schema): void {
    if (data === null || typeof data !== 'object') {
      throw new Error(`Expected object for schema ${schema.name}`)
    }

    const obj = data as Record<string, unknown>

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const value = obj[fieldName]

      // Check required fields
      if (fieldDef.required && (value === undefined || value === null)) {
        throw new Error(`Missing required field: ${fieldName}`)
      }

      // Skip validation if value is undefined/null and not required
      if (value === undefined || value === null) {
        continue
      }

      // Type validation
      this.validateFieldType(value, fieldDef.type, fieldName)
    }
  }

  private validateFieldType(value: unknown, type: string, fieldName: string): void {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') {
          throw new Error(`Field ${fieldName} must be a string`)
        }
        break
      case 'number':
        if (typeof value !== 'number') {
          throw new Error(`Field ${fieldName} must be a number`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Field ${fieldName} must be a boolean`)
        }
        break
      case 'date':
        if (!(value instanceof Date)) {
          throw new Error(`Field ${fieldName} must be a Date`)
        }
        break
      case 'bigint':
        if (typeof value !== 'bigint') {
          throw new Error(`Field ${fieldName} must be a bigint`)
        }
        break
      case 'array':
        if (!Array.isArray(value)) {
          throw new Error(`Field ${fieldName} must be an array`)
        }
        break
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Field ${fieldName} must be an object`)
        }
        break
      case 'map':
        if (!(value instanceof Map)) {
          throw new Error(`Field ${fieldName} must be a Map`)
        }
        break
      case 'set':
        if (!(value instanceof Set)) {
          throw new Error(`Field ${fieldName} must be a Set`)
        }
        break
      case 'buffer':
        if (!(value instanceof Uint8Array)) {
          throw new Error(`Field ${fieldName} must be a Uint8Array`)
        }
        break
    }
  }
}
