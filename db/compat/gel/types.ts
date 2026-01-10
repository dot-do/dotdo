/**
 * EdgeDB/Gel Type System Compatibility Layer
 *
 * Maps EdgeDB types to SQLite storage and JavaScript runtime types.
 * Provides serialization, deserialization, and validation for all EdgeDB scalar
 * and collection types.
 */

// =============================================================================
// TYPE INTERFACES
// =============================================================================

/** Duration in microseconds (EdgeDB std::duration) */
export interface Duration {
  microseconds: bigint
}

/** Relative duration with calendar components (EdgeDB cal::relative_duration) */
export interface RelativeDuration {
  months: number
  days: number
  microseconds: bigint
}

/** Date-only duration (EdgeDB cal::date_duration) */
export interface DateDuration {
  months: number
  days: number
}

/** Calendar date without time (EdgeDB cal::local_date) */
export interface LocalDate {
  year: number
  month: number
  day: number
}

/** Time without date or timezone (EdgeDB cal::local_time) */
export interface LocalTime {
  hour: number
  minute: number
  second: number
  nanosecond: number
}

/** Date and time without timezone (EdgeDB cal::local_datetime) */
export interface LocalDateTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  nanosecond: number
}

/** Range with inclusive/exclusive bounds */
export interface Range<T> {
  lower: T | null
  upper: T | null
  inc_lower: boolean
  inc_upper: boolean
  empty: boolean
}

/** Valid JSON types */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** Enum definition */
export interface EnumDef<T extends readonly string[]> {
  name: string
  values: T
}

/** Cardinality types */
export type Cardinality = 'One' | 'AtMostOne' | 'AtLeastOne' | 'Many'

// =============================================================================
// ERROR CLASSES
// =============================================================================

export class CardinalityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardinalityError'
  }
}

// =============================================================================
// STRING TYPE (str)
// =============================================================================

export function serializeStr(value: string | null): string | null {
  if (value === null) return null
  return value
}

export function deserializeStr(value: string | null): string | null {
  if (value === null) return null
  return value
}

export function validateStr(value: unknown): boolean {
  return typeof value === 'string'
}

// =============================================================================
// BOOLEAN TYPE (bool)
// =============================================================================

export function serializeBool(value: boolean): number {
  return value ? 1 : 0
}

export function deserializeBool(value: number): boolean {
  return value !== 0
}

export function validateBool(value: unknown): boolean {
  return typeof value === 'boolean'
}

// =============================================================================
// UUID TYPE
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function serializeUuid(value: string): string {
  if (!UUID_REGEX.test(value)) {
    throw new TypeError(`Invalid UUID format: ${value}`)
  }
  return value.toLowerCase()
}

export function deserializeUuid(value: string): string {
  return value
}

export function validateUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

// =============================================================================
// INTEGER TYPES (int16, int32, int64)
// =============================================================================

const MIN_INT16 = -32768
const MAX_INT16 = 32767
const MIN_INT32 = -2147483648
const MAX_INT32 = 2147483647
const MIN_INT64 = BigInt('-9223372036854775808')
const MAX_INT64 = BigInt('9223372036854775807')

export function serializeInt16(value: number): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Expected integer, got ${value}`)
  }
  if (value < MIN_INT16 || value > MAX_INT16) {
    throw new RangeError(`int16 out of range: ${value} (must be ${MIN_INT16} to ${MAX_INT16})`)
  }
  return value
}

export function deserializeInt16(value: number): number {
  return value
}

export function validateInt16(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_INT16 && value <= MAX_INT16
}

export function serializeInt32(value: number): number {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Expected integer, got ${value}`)
  }
  if (value < MIN_INT32 || value > MAX_INT32) {
    throw new RangeError(`int32 out of range: ${value} (must be ${MIN_INT32} to ${MAX_INT32})`)
  }
  return value
}

export function deserializeInt32(value: number): number {
  return value
}

export function validateInt32(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_INT32 && value <= MAX_INT32
}

export function serializeInt64(value: number | bigint): number | bigint {
  if (typeof value === 'bigint') {
    if (value < MIN_INT64 || value > MAX_INT64) {
      throw new RangeError(`int64 out of range: ${value}`)
    }
    // If within safe integer range, return as number
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value)
    }
    return value
  }
  // Number input
  if (!Number.isInteger(value)) {
    throw new TypeError(`Expected integer, got ${value}`)
  }
  return value
}

export function deserializeInt64(value: number | bigint, useBigInt?: boolean): number | bigint {
  if (useBigInt) {
    return typeof value === 'bigint' ? value : BigInt(value)
  }
  if (typeof value === 'number') {
    // Check if value is beyond safe integer range
    if (!Number.isSafeInteger(value)) {
      return BigInt(value)
    }
    return value
  }
  return value
}

export function validateInt64(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value)
  }
  if (typeof value === 'bigint') {
    return value >= MIN_INT64 && value <= MAX_INT64
  }
  return false
}

// =============================================================================
// FLOATING POINT TYPES (float32, float64)
// =============================================================================

export function serializeFloat32(value: number): number {
  if (typeof value !== 'number') {
    throw new TypeError(`Expected number, got ${typeof value}`)
  }
  if (value === Infinity || value === -Infinity) {
    throw new RangeError('Infinity is not allowed for float32')
  }
  return value
}

export function deserializeFloat32(value: number): number {
  return value
}

export function validateFloat32(value: unknown): boolean {
  if (typeof value !== 'number') return false
  if (value === Infinity || value === -Infinity) return false
  return true
}

export function serializeFloat64(value: number): number {
  if (typeof value !== 'number') {
    throw new TypeError(`Expected number, got ${typeof value}`)
  }
  return value
}

export function deserializeFloat64(value: number): number {
  return value
}

export function validateFloat64(value: unknown): boolean {
  return typeof value === 'number'
}

// =============================================================================
// ARBITRARY PRECISION TYPES (bigint, decimal)
// =============================================================================

export function serializeBigInt(value: bigint): string {
  return value.toString()
}

export function deserializeBigInt(value: string): bigint {
  return BigInt(value)
}

export function validateBigInt(value: unknown): boolean {
  return typeof value === 'bigint'
}

const DECIMAL_REGEX = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

export function serializeDecimal(value: string): string {
  if (!DECIMAL_REGEX.test(value)) {
    throw new TypeError(`Invalid decimal format: ${value}`)
  }
  return value
}

export function deserializeDecimal(value: string): string {
  return value
}

export function validateDecimal(value: unknown): boolean {
  return typeof value === 'string' && DECIMAL_REGEX.test(value)
}

// =============================================================================
// JSON TYPE
// =============================================================================

export function serializeJson(value: JsonValue): string {
  return JSON.stringify(value)
}

export function deserializeJson(value: string): JsonValue {
  return JSON.parse(value)
}

export function validateJson(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value === 'function') return false
  if (typeof value === 'symbol') return false
  return true
}

// =============================================================================
// BYTES TYPE
// =============================================================================

export function serializeBytes(value: Uint8Array): Uint8Array {
  return value
}

export function deserializeBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return value
}

export function validateBytes(value: unknown): boolean {
  return value instanceof Uint8Array
}

// =============================================================================
// DATETIME TYPE
// =============================================================================

const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

export function serializeDatetime(value: Date): string {
  return value.toISOString()
}

export function deserializeDatetime(value: string): Date {
  if (!ISO8601_REGEX.test(value)) {
    throw new TypeError(`Invalid ISO 8601 datetime format: ${value}`)
  }
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    throw new TypeError(`Invalid datetime: ${value}`)
  }
  return date
}

export function validateDatetime(value: unknown): boolean {
  return value instanceof Date && !isNaN(value.getTime())
}

// =============================================================================
// DURATION TYPE (std::duration)
// =============================================================================

const MICROSECONDS_PER_SECOND = BigInt(1000000)
const MICROSECONDS_PER_MINUTE = BigInt(60000000)
const MICROSECONDS_PER_HOUR = BigInt(3600000000)

/** Extract hours, minutes, seconds, microseconds from total microseconds */
function extractTimeComponents(us: bigint): { hours: bigint; minutes: bigint; seconds: bigint; microseconds: bigint } {
  const hours = us / MICROSECONDS_PER_HOUR
  let remaining = us % MICROSECONDS_PER_HOUR
  const minutes = remaining / MICROSECONDS_PER_MINUTE
  remaining = remaining % MICROSECONDS_PER_MINUTE
  const seconds = remaining / MICROSECONDS_PER_SECOND
  const microseconds = remaining % MICROSECONDS_PER_SECOND
  return { hours, minutes, seconds, microseconds }
}

/** Format time components as ISO 8601 duration time part (H, M, S) */
function formatTimeComponents(components: { hours: bigint; minutes: bigint; seconds: bigint; microseconds: bigint }): string {
  const { hours, minutes, seconds, microseconds } = components
  let result = ''
  if (hours > 0) result += `${hours}H`
  if (minutes > 0) result += `${minutes}M`
  if (seconds > 0 || microseconds > 0) {
    if (microseconds > 0) {
      result += `${seconds}.${microseconds.toString().padStart(6, '0')}S`
    } else {
      result += `${seconds}S`
    }
  }
  return result
}

/** Parse seconds string (with optional fractional part) to microseconds */
function parseSecondsToMicroseconds(secondsStr: string): bigint {
  if (secondsStr.includes('.')) {
    const [intPart, fracPart] = secondsStr.split('.')
    const intSeconds = BigInt(intPart || '0')
    const paddedFrac = fracPart.padEnd(6, '0').slice(0, 6)
    return intSeconds * MICROSECONDS_PER_SECOND + BigInt(paddedFrac)
  }
  return BigInt(secondsStr) * MICROSECONDS_PER_SECOND
}

export function serializeDuration(value: Duration): string {
  if (value.microseconds === BigInt(0)) {
    return 'PT0S'
  }
  return 'PT' + formatTimeComponents(extractTimeComponents(value.microseconds))
}

const DURATION_REGEX = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/

export function deserializeDuration(value: string): Duration {
  const match = DURATION_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid duration format: ${value}. Expected PT[nH][nM][nS] format`)
  }

  const hours = match[1] ? BigInt(match[1]) : BigInt(0)
  const minutes = match[2] ? BigInt(match[2]) : BigInt(0)
  const secondsStr = match[3] || '0'

  const microseconds = hours * MICROSECONDS_PER_HOUR +
    minutes * MICROSECONDS_PER_MINUTE +
    parseSecondsToMicroseconds(secondsStr)

  return { microseconds }
}

export function validateDuration(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const d = value as Duration
  return typeof d.microseconds === 'bigint'
}

// =============================================================================
// RELATIVE DURATION TYPE (cal::relative_duration)
// =============================================================================

export function serializeRelativeDuration(value: RelativeDuration): string {
  const { months, days, microseconds } = value

  if (months === 0 && days === 0 && microseconds === BigInt(0)) {
    return 'P0D'
  }

  let result = 'P'

  const years = Math.floor(months / 12)
  const remainingMonths = months % 12

  if (years > 0) result += `${years}Y`
  if (remainingMonths > 0) result += `${remainingMonths}M`
  if (days > 0) result += `${days}D`

  if (microseconds > BigInt(0)) {
    result += 'T' + formatTimeComponents(extractTimeComponents(microseconds))
  }

  return result
}

const RELATIVE_DURATION_REGEX = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

export function deserializeRelativeDuration(value: string): RelativeDuration {
  const match = RELATIVE_DURATION_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid relative duration format: ${value}`)
  }

  const years = parseInt(match[1] || '0', 10)
  const monthsPart = parseInt(match[2] || '0', 10)
  const days = parseInt(match[3] || '0', 10)
  const hours = match[4] ? BigInt(match[4]) : BigInt(0)
  const minutes = match[5] ? BigInt(match[5]) : BigInt(0)
  const secondsStr = match[6] || '0'

  const microseconds = hours * MICROSECONDS_PER_HOUR +
    minutes * MICROSECONDS_PER_MINUTE +
    parseSecondsToMicroseconds(secondsStr)

  return {
    months: years * 12 + monthsPart,
    days,
    microseconds
  }
}

// =============================================================================
// DATE DURATION TYPE (cal::date_duration)
// =============================================================================

export function serializeDateDuration(value: DateDuration): string {
  const { months, days } = value

  if (months === 0 && days === 0) {
    return 'P0D'
  }

  let result = 'P'

  const years = Math.floor(months / 12)
  const remainingMonths = months % 12

  if (years > 0) result += `${years}Y`
  if (remainingMonths > 0) result += `${remainingMonths}M`
  if (days > 0) result += `${days}D`

  return result
}

const DATE_DURATION_REGEX = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/

export function deserializeDateDuration(value: string): DateDuration {
  const match = DATE_DURATION_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid date duration format: ${value}`)
  }

  const years = parseInt(match[1] || '0', 10)
  const monthsPart = parseInt(match[2] || '0', 10)
  const days = parseInt(match[3] || '0', 10)

  return {
    months: years * 12 + monthsPart,
    days
  }
}

// =============================================================================
// LOCAL DATE TYPE (cal::local_date)
// =============================================================================

export function serializeLocalDate(value: LocalDate): string {
  const year = value.year.toString().padStart(4, '0')
  const month = value.month.toString().padStart(2, '0')
  const day = value.day.toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

const LOCAL_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

export function deserializeLocalDate(value: string): LocalDate {
  const match = LOCAL_DATE_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid local date format: ${value}`)
  }

  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10)
  }
}

export function validateLocalDate(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const d = value as LocalDate
  if (typeof d.year !== 'number' || typeof d.month !== 'number' || typeof d.day !== 'number') {
    return false
  }
  if (d.month < 1 || d.month > 12) return false
  if (d.day < 1 || d.day > 31) return false
  return true
}

// =============================================================================
// LOCAL TIME TYPE (cal::local_time)
// =============================================================================

export function serializeLocalTime(value: LocalTime): string {
  const hour = value.hour.toString().padStart(2, '0')
  const minute = value.minute.toString().padStart(2, '0')
  const second = value.second.toString().padStart(2, '0')

  // Convert nanoseconds to microseconds (truncate to 6 digits)
  const microseconds = Math.floor(value.nanosecond / 1000)

  if (microseconds > 0) {
    const usStr = microseconds.toString().padStart(6, '0')
    return `${hour}:${minute}:${second}.${usStr}`
  }

  return `${hour}:${minute}:${second}`
}

const LOCAL_TIME_REGEX = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/

export function deserializeLocalTime(value: string): LocalTime {
  const match = LOCAL_TIME_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid local time format: ${value}`)
  }

  const microseconds = match[4] ? parseInt(match[4].padEnd(6, '0'), 10) : 0

  return {
    hour: parseInt(match[1], 10),
    minute: parseInt(match[2], 10),
    second: parseInt(match[3], 10),
    nanosecond: microseconds * 1000 // Convert microseconds to nanoseconds
  }
}

export function validateLocalTime(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const t = value as LocalTime
  if (typeof t.hour !== 'number' || typeof t.minute !== 'number' ||
      typeof t.second !== 'number' || typeof t.nanosecond !== 'number') {
    return false
  }
  if (t.hour < 0 || t.hour > 23) return false
  if (t.minute < 0 || t.minute > 59) return false
  if (t.second < 0 || t.second > 59) return false
  if (t.nanosecond < 0 || t.nanosecond > 999999999) return false
  return true
}

// =============================================================================
// LOCAL DATETIME TYPE (cal::local_datetime)
// =============================================================================

export function serializeLocalDateTime(value: LocalDateTime): string {
  const datePart = serializeLocalDate(value)
  const timePart = serializeLocalTime(value)
  return `${datePart}T${timePart}`
}

const LOCAL_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/

export function deserializeLocalDateTime(value: string): LocalDateTime {
  const match = LOCAL_DATETIME_REGEX.exec(value)
  if (!match) {
    throw new TypeError(`Invalid local datetime format: ${value}`)
  }

  const microseconds = match[7] ? parseInt(match[7].padEnd(6, '0'), 10) : 0

  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
    hour: parseInt(match[4], 10),
    minute: parseInt(match[5], 10),
    second: parseInt(match[6], 10),
    nanosecond: microseconds * 1000
  }
}

export function validateLocalDateTime(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const dt = value as LocalDateTime
  // Validate date part
  if (!validateLocalDate({ year: dt.year, month: dt.month, day: dt.day })) {
    return false
  }
  // Validate time part
  if (!validateLocalTime({ hour: dt.hour, minute: dt.minute, second: dt.second, nanosecond: dt.nanosecond })) {
    return false
  }
  return true
}

// =============================================================================
// ENUM TYPE
// =============================================================================

export function serializeEnum<T extends readonly string[]>(
  value: string,
  enumDef: EnumDef<T>
): string {
  if (!enumDef.values.includes(value as T[number])) {
    throw new TypeError(
      `Invalid enum value "${value}" for ${enumDef.name}. Valid values: ${enumDef.values.join(', ')}`
    )
  }
  return value
}

export function deserializeEnum<T extends readonly string[]>(
  value: string,
  enumDef: EnumDef<T>
): T[number] {
  return value as T[number]
}

export function validateEnum<T extends readonly string[]>(
  value: unknown,
  enumDef: EnumDef<T>
): boolean {
  if (typeof value !== 'string') return false
  return enumDef.values.includes(value as T[number])
}

// =============================================================================
// ARRAY TYPE
// =============================================================================

type Serializer<T, S> = ((value: T) => S) | StringConstructor | NumberConstructor | BooleanConstructor
type Deserializer<S, T> = ((value: S) => T) | StringConstructor | NumberConstructor | BooleanConstructor

function applySerializer<T, S>(value: T, serializer: Serializer<T, S>): S {
  if (serializer === String) return String(value) as S
  if (serializer === Number) return Number(value) as S
  if (serializer === Boolean) return Boolean(value) as S
  return (serializer as (value: T) => S)(value)
}

function applyDeserializer<S, T>(value: S, deserializer: Deserializer<S, T>): T {
  if (deserializer === String) return String(value) as T
  if (deserializer === Number) return Number(value) as T
  if (deserializer === Boolean) return Boolean(value) as T
  return (deserializer as (value: S) => T)(value)
}

export function serializeArray<T, S = T>(
  value: T[],
  serializer: Serializer<T, S>
): string {
  const serialized = value.map(item => applySerializer(item, serializer))
  return JSON.stringify(serialized)
}

export function deserializeArray<S, T = S>(
  value: string,
  deserializer: Deserializer<S, T>
): T[] {
  const parsed = JSON.parse(value) as S[]
  return parsed.map(item => applyDeserializer(item, deserializer))
}

// =============================================================================
// TUPLE TYPE
// =============================================================================

type TupleSerializers = (Serializer<any, any>)[]
type TupleDeserializers = (Deserializer<any, any>)[]

export function serializeTuple(
  value: unknown[],
  serializers: TupleSerializers
): string {
  if (value.length !== serializers.length) {
    throw new TypeError(
      `Tuple length mismatch: expected ${serializers.length}, got ${value.length}`
    )
  }
  const serialized = value.map((item, i) => applySerializer(item, serializers[i]))
  return JSON.stringify(serialized)
}

export function deserializeTuple(
  value: string,
  deserializers: TupleDeserializers
): unknown[] {
  const parsed = JSON.parse(value) as unknown[]
  return parsed.map((item, i) => applyDeserializer(item, deserializers[i]))
}

// =============================================================================
// RANGE TYPE
// =============================================================================

interface SerializedRange<S> {
  lower?: S | null
  upper?: S | null
  inc_lower?: boolean
  inc_upper?: boolean
  empty: boolean
}

export function serializeRange<T, S = T>(
  value: Range<T>,
  serializer: Serializer<T, S>
): string {
  if (value.empty) {
    return JSON.stringify({ empty: true })
  }

  const result: SerializedRange<S> = {
    lower: value.lower !== null ? applySerializer(value.lower, serializer) : null,
    upper: value.upper !== null ? applySerializer(value.upper, serializer) : null,
    inc_lower: value.inc_lower,
    inc_upper: value.inc_upper,
    empty: false
  }

  return JSON.stringify(result)
}

export function deserializeRange<S, T = S>(
  value: string,
  deserializer: Deserializer<S, T>
): Range<T> {
  const parsed = JSON.parse(value) as SerializedRange<S>

  if (parsed.empty) {
    return {
      lower: null,
      upper: null,
      inc_lower: false,
      inc_upper: false,
      empty: true
    }
  }

  return {
    lower: parsed.lower !== null && parsed.lower !== undefined
      ? applyDeserializer(parsed.lower, deserializer)
      : null,
    upper: parsed.upper !== null && parsed.upper !== undefined
      ? applyDeserializer(parsed.upper, deserializer)
      : null,
    inc_lower: parsed.inc_lower ?? false,
    inc_upper: parsed.inc_upper ?? false,
    empty: false
  }
}

// =============================================================================
// MULTIRANGE TYPE
// =============================================================================

export function serializeMultiRange<T, S = T>(
  value: Range<T>[],
  serializer: Serializer<T, S>
): string {
  const serialized = value.map(range => JSON.parse(serializeRange(range, serializer)))
  return JSON.stringify(serialized)
}

export function deserializeMultiRange<S, T = S>(
  value: string,
  deserializer: Deserializer<S, T>
): Range<T>[] {
  const parsed = JSON.parse(value) as SerializedRange<S>[]
  return parsed.map(range => deserializeRange(JSON.stringify(range), deserializer))
}

// =============================================================================
// CARDINALITY ENFORCEMENT
// =============================================================================

export function validateRequired<T>(value: T): void {
  if (value === null || value === undefined) {
    throw new CardinalityError('Required value cannot be null or undefined')
  }
}

export function validateAtLeastOne<T>(value: T[]): void {
  if (!Array.isArray(value)) {
    throw new CardinalityError('Expected array for AtLeastOne cardinality')
  }
  if (value.length === 0) {
    throw new CardinalityError('AtLeastOne cardinality requires at least one element')
  }
}

export function deserializeCardinality<T>(
  values: T[],
  cardinality: Cardinality
): T | T[] | null {
  switch (cardinality) {
    case 'One':
      if (values.length === 0) {
        throw new CardinalityError('One cardinality requires exactly one value, got 0')
      }
      if (values.length > 1) {
        throw new CardinalityError(`One cardinality requires exactly one value, got ${values.length}`)
      }
      return values[0]

    case 'AtMostOne':
      if (values.length === 0) {
        return null
      }
      if (values.length > 1) {
        throw new CardinalityError(`AtMostOne cardinality allows at most one value, got ${values.length}`)
      }
      return values[0]

    case 'AtLeastOne':
      if (values.length === 0) {
        throw new CardinalityError('AtLeastOne cardinality requires at least one value')
      }
      return values

    case 'Many':
      return values

    default:
      throw new Error(`Unknown cardinality: ${cardinality}`)
  }
}
