# SPIKE: EdgeDB/Gel Type System Compatibility

**Issue:** dotdo-l17gw
**Status:** SPIKE Complete
**Date:** 2026-01-10

## Executive Summary

This spike documents how EdgeDB's rich type system maps to SQLite types and JavaScript runtime types for the `@dotdo/gel` compatibility layer. EdgeDB (now Gel) has a sophisticated type system with 14 scalar types, 3 duration types, range/multirange types, and a cardinality system. Most types map cleanly to SQLite TEXT/INTEGER/REAL/BLOB with JSON serialization, but several edge cases require careful handling.

## Complete Type Mapping Matrix

### Core Scalar Types

| EdgeDB Type | SQLite Storage | JS Runtime | Serialization | Notes |
|-------------|----------------|------------|---------------|-------|
| `str` | TEXT | `string` | Identity | UTF-8 encoded |
| `bool` | INTEGER | `boolean` | `1`/`0` | Boolean coercion |
| `uuid` | TEXT | `string` | RFC 4122 format | 36-char with dashes, validated |
| `json` | TEXT | `object \| array \| primitive` | `JSON.stringify`/`parse` | Native SQLite JSON1 extension available |
| `bytes` | BLOB | `Uint8Array` | Binary | Direct BLOB storage |

### Numeric Types

| EdgeDB Type | SQLite Storage | JS Runtime | Range | Serialization Notes |
|-------------|----------------|------------|-------|---------------------|
| `int16` | INTEGER | `number` | -32,768 to +32,767 | Validated on write |
| `int32` | INTEGER | `number` | -2,147,483,648 to +2,147,483,647 | Validated on write |
| `int64` | INTEGER | `number \| bigint` | -9.2e18 to +9.2e18 | SQLite INTEGER is 64-bit; JS number loses precision > 2^53 |
| `float32` | REAL | `number` | ~6 decimal digits, -3.4e38 to +3.4e38 | May lose precision vs float64 |
| `float64` | REAL | `number` | ~15 decimal digits, -1.7e308 to +1.7e308 | Native SQLite REAL |
| `bigint` | TEXT | `bigint` | Arbitrary precision | String storage preserves precision |
| `decimal` | TEXT | `string` | Arbitrary precision | String storage; no native JS decimal |

### Date/Time Types

| EdgeDB Type | SQLite Storage | JS Runtime | Format | Notes |
|-------------|----------------|------------|--------|-------|
| `datetime` | TEXT | `Date` | ISO 8601 with TZ | `2024-01-15T10:30:00.000Z` |
| `cal::local_datetime` | TEXT | `{ year, month, day, hour, minute, second, nanosecond }` | ISO 8601 no TZ | No timezone info |
| `cal::local_date` | TEXT | `{ year, month, day }` | `YYYY-MM-DD` | Date only |
| `cal::local_time` | TEXT | `{ hour, minute, second, nanosecond }` | `HH:MM:SS.sss` | Time only |
| `duration` | TEXT | `{ microseconds }` or custom class | ISO 8601 duration | Fixed duration (hours max) |
| `cal::relative_duration` | TEXT | `{ months, days, hours, minutes, seconds, microseconds }` | ISO 8601 interval | Calendar-aware ("1 month") |
| `cal::date_duration` | TEXT | `{ months, days }` | ISO 8601 interval | Whole days only |

### Special Types

| EdgeDB Type | SQLite Storage | JS Runtime | Notes |
|-------------|----------------|------------|-------|
| `enum<...>` | TEXT | `string` | Validated against enum values |
| `sequence` | INTEGER | `number` | Auto-incrementing int64 counter |
| `array<T>` | TEXT | `T[]` | JSON array serialization |
| `tuple<T1, T2, ...>` | TEXT | `[T1, T2, ...]` | JSON array serialization |
| `range<T>` | TEXT | `{ lower, upper, inc_lower, inc_upper, empty }` | JSON object |
| `multirange<T>` | TEXT | `Array<Range<T>>` | JSON array of ranges |

---

## Detailed Type Specifications

### 1. String Type (`str`)

```typescript
// SQLite: TEXT
// JS: string

function serializeStr(value: string): string {
  return value // Identity transformation
}

function deserializeStr(value: string): string {
  return value
}

// Validation: Must be valid UTF-8
function validateStr(value: unknown): value is string {
  return typeof value === 'string'
}
```

### 2. Boolean Type (`bool`)

```typescript
// SQLite: INTEGER (0 or 1)
// JS: boolean

function serializeBool(value: boolean): number {
  return value ? 1 : 0
}

function deserializeBool(value: number): boolean {
  return value !== 0
}

function validateBool(value: unknown): value is boolean {
  return typeof value === 'boolean'
}
```

### 3. UUID Type (`uuid`)

```typescript
// SQLite: TEXT (36 characters with dashes)
// JS: string

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function serializeUuid(value: string): string {
  if (!UUID_REGEX.test(value)) {
    throw new TypeError(`Invalid UUID: ${value}`)
  }
  return value.toLowerCase()
}

function deserializeUuid(value: string): string {
  return value // Already validated on write
}

function validateUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

function generateUuid(): string {
  return crypto.randomUUID()
}
```

### 4. Integer Types (`int16`, `int32`, `int64`)

```typescript
// SQLite: INTEGER (all sizes)
// JS: number (int16, int32) or number|bigint (int64)

const INT_RANGES = {
  int16: { min: -32768, max: 32767 },
  int32: { min: -2147483648, max: 2147483647 },
  int64: { min: BigInt('-9223372036854775808'), max: BigInt('9223372036854775807') },
} as const

function serializeInt16(value: number): number {
  if (!Number.isInteger(value) || value < INT_RANGES.int16.min || value > INT_RANGES.int16.max) {
    throw new RangeError(`int16 out of range: ${value}`)
  }
  return value
}

function serializeInt32(value: number): number {
  if (!Number.isInteger(value) || value < INT_RANGES.int32.min || value > INT_RANGES.int32.max) {
    throw new RangeError(`int32 out of range: ${value}`)
  }
  return value
}

function serializeInt64(value: number | bigint): number {
  const bigVal = typeof value === 'bigint' ? value : BigInt(value)
  if (bigVal < INT_RANGES.int64.min || bigVal > INT_RANGES.int64.max) {
    throw new RangeError(`int64 out of range: ${value}`)
  }
  return Number(bigVal) // SQLite stores as 64-bit integer
}

function deserializeInt64(value: number, useBigInt: boolean = false): number | bigint {
  if (useBigInt || !Number.isSafeInteger(value)) {
    return BigInt(value)
  }
  return value
}
```

**Precision Warning:** JavaScript `number` loses precision for integers > 2^53. When `int64` values exceed `Number.MAX_SAFE_INTEGER`, the client should use `bigint`.

### 5. Floating Point Types (`float32`, `float64`)

```typescript
// SQLite: REAL (64-bit IEEE 754)
// JS: number

const FLOAT_RANGES = {
  float32: { min: -3.4028235e38, max: 3.4028235e38 },
  float64: { min: -1.7976931348623157e308, max: 1.7976931348623157e308 },
} as const

function serializeFloat32(value: number): number {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return value // NaN preserved
    throw new RangeError(`float32 infinity not supported`)
  }
  // Note: Precision loss occurs when storing float32 in SQLite REAL (float64)
  return value
}

function serializeFloat64(value: number): number {
  return value // Native SQLite REAL
}

function deserializeFloat(value: number): number {
  return value
}
```

**Limitation:** SQLite REAL is always 64-bit, so `float32` values stored and retrieved may have different bit representations due to precision expansion.

### 6. Arbitrary Precision Types (`bigint`, `decimal`)

```typescript
// SQLite: TEXT (preserves arbitrary precision)
// JS: bigint (for bigint), string (for decimal)

function serializeBigInt(value: bigint): string {
  return value.toString()
}

function deserializeBigInt(value: string): bigint {
  return BigInt(value)
}

function serializeDecimal(value: string): string {
  // Validate decimal format
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    throw new TypeError(`Invalid decimal: ${value}`)
  }
  return value
}

function deserializeDecimal(value: string): string {
  return value // JS has no native arbitrary-precision decimal
}
```

**Recommendation:** For decimal operations in JS, use a library like `decimal.js` or `big.js`.

### 7. JSON Type (`json`)

```typescript
// SQLite: TEXT (JSON string) - can use JSON1 extension
// JS: JsonValue

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function serializeJson(value: JsonValue): string {
  return JSON.stringify(value)
}

function deserializeJson(value: string): JsonValue {
  return JSON.parse(value)
}

// SQLite JSON1 extension enables:
// - json_extract(column, '$.path')
// - json_type(column)
// - json_valid(column)
```

### 8. Bytes Type (`bytes`)

```typescript
// SQLite: BLOB
// JS: Uint8Array

function serializeBytes(value: Uint8Array): Uint8Array {
  return value // Direct BLOB storage
}

function deserializeBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

// For base64 interchange:
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)))
}
```

### 9. DateTime Type (`datetime`)

```typescript
// SQLite: TEXT (ISO 8601 with timezone)
// JS: Date

function serializeDatetime(value: Date): string {
  return value.toISOString() // Always UTC: "2024-01-15T10:30:00.000Z"
}

function deserializeDatetime(value: string): Date {
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    throw new TypeError(`Invalid datetime: ${value}`)
  }
  return date
}

// Validation: ISO 8601 format
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/
```

### 10. Duration Type (`duration`)

```typescript
// SQLite: TEXT (ISO 8601 duration, hours max unit)
// JS: { microseconds: bigint } or Duration class

interface Duration {
  readonly microseconds: bigint
}

// EdgeDB duration only supports units up to hours (no days/months/years)
function serializeDuration(value: Duration): string {
  const us = value.microseconds
  const hours = us / BigInt(3_600_000_000)
  const minutes = (us % BigInt(3_600_000_000)) / BigInt(60_000_000)
  const seconds = (us % BigInt(60_000_000)) / BigInt(1_000_000)
  const microseconds = us % BigInt(1_000_000)

  let result = 'PT'
  if (hours !== BigInt(0)) result += `${hours}H`
  if (minutes !== BigInt(0)) result += `${minutes}M`
  if (seconds !== BigInt(0) || microseconds !== BigInt(0)) {
    result += `${seconds}`
    if (microseconds !== BigInt(0)) {
      result += `.${microseconds.toString().padStart(6, '0')}`
    }
    result += 'S'
  }
  return result === 'PT' ? 'PT0S' : result
}

function deserializeDuration(value: string): Duration {
  // Parse ISO 8601 duration (e.g., "PT1H30M45.123456S")
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/)
  if (!match) throw new TypeError(`Invalid duration: ${value}`)

  const hours = BigInt(match[1] || 0)
  const minutes = BigInt(match[2] || 0)
  const secondsStr = match[3] || '0'
  const [secs, microsStr = '0'] = secondsStr.split('.')
  const seconds = BigInt(secs)
  const microseconds = BigInt(microsStr.padEnd(6, '0').slice(0, 6))

  return {
    microseconds: hours * BigInt(3_600_000_000) +
                  minutes * BigInt(60_000_000) +
                  seconds * BigInt(1_000_000) +
                  microseconds
  }
}
```

### 11. Relative Duration (`cal::relative_duration`)

```typescript
// SQLite: TEXT (ISO 8601 interval)
// JS: RelativeDuration object

interface RelativeDuration {
  readonly months: number
  readonly days: number
  readonly microseconds: bigint
}

function serializeRelativeDuration(value: RelativeDuration): string {
  // ISO 8601: P[n]Y[n]M[n]DT[n]H[n]M[n]S
  let result = 'P'

  const years = Math.floor(value.months / 12)
  const months = value.months % 12

  if (years !== 0) result += `${years}Y`
  if (months !== 0) result += `${months}M`
  if (value.days !== 0) result += `${value.days}D`

  if (value.microseconds !== BigInt(0)) {
    result += 'T'
    const us = value.microseconds
    const hours = Number(us / BigInt(3_600_000_000))
    const minutes = Number((us % BigInt(3_600_000_000)) / BigInt(60_000_000))
    const seconds = Number((us % BigInt(60_000_000)) / BigInt(1_000_000))
    const micros = Number(us % BigInt(1_000_000))

    if (hours !== 0) result += `${hours}H`
    if (minutes !== 0) result += `${minutes}M`
    if (seconds !== 0 || micros !== 0) {
      result += micros !== 0 ? `${seconds}.${micros.toString().padStart(6, '0')}S` : `${seconds}S`
    }
  }

  return result === 'P' ? 'P0D' : result
}
```

### 12. Date Duration (`cal::date_duration`)

```typescript
// SQLite: TEXT (ISO 8601 interval, days granularity)
// JS: DateDuration object

interface DateDuration {
  readonly months: number
  readonly days: number
}

function serializeDateDuration(value: DateDuration): string {
  let result = 'P'
  const years = Math.floor(value.months / 12)
  const months = value.months % 12

  if (years !== 0) result += `${years}Y`
  if (months !== 0) result += `${months}M`
  if (value.days !== 0) result += `${value.days}D`

  return result === 'P' ? 'P0D' : result
}
```

### 13. Local Date/Time Types

```typescript
// cal::local_date - SQLite: TEXT (YYYY-MM-DD)
interface LocalDate {
  readonly year: number
  readonly month: number  // 1-12
  readonly day: number    // 1-31
}

function serializeLocalDate(value: LocalDate): string {
  return `${value.year.toString().padStart(4, '0')}-${value.month.toString().padStart(2, '0')}-${value.day.toString().padStart(2, '0')}`
}

// cal::local_time - SQLite: TEXT (HH:MM:SS.ssssss)
interface LocalTime {
  readonly hour: number       // 0-23
  readonly minute: number     // 0-59
  readonly second: number     // 0-59
  readonly nanosecond: number // 0-999999999 (microsecond precision stored)
}

function serializeLocalTime(value: LocalTime): string {
  const micros = Math.floor(value.nanosecond / 1000)
  const base = `${value.hour.toString().padStart(2, '0')}:${value.minute.toString().padStart(2, '0')}:${value.second.toString().padStart(2, '0')}`
  return micros > 0 ? `${base}.${micros.toString().padStart(6, '0')}` : base
}

// cal::local_datetime - SQLite: TEXT (ISO 8601 without TZ)
interface LocalDateTime {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly nanosecond: number
}

function serializeLocalDateTime(value: LocalDateTime): string {
  const date = serializeLocalDate(value)
  const time = serializeLocalTime(value)
  return `${date}T${time}`
}
```

### 14. Enum Type

```typescript
// SQLite: TEXT
// JS: string (validated against enum values)

interface EnumType {
  name: string
  values: readonly string[]
}

function createEnumSerializer(enumType: EnumType) {
  const validValues = new Set(enumType.values)

  return {
    serialize(value: string): string {
      if (!validValues.has(value)) {
        throw new TypeError(`Invalid enum value '${value}' for ${enumType.name}. Valid values: ${enumType.values.join(', ')}`)
      }
      return value
    },
    deserialize(value: string): string {
      return value // Already validated on write
    },
    validate(value: unknown): value is string {
      return typeof value === 'string' && validValues.has(value)
    }
  }
}

// Example usage:
// scalar type Status extending enum<'pending', 'active', 'completed'>;
const StatusEnum = createEnumSerializer({
  name: 'Status',
  values: ['pending', 'active', 'completed'] as const
})
```

### 15. Sequence Type

```typescript
// SQLite: INTEGER (with auto-increment behavior)
// JS: number

// Sequences require special handling at the schema level
// Each sequence type gets its own counter stored in a metadata table

interface SequenceMetadata {
  name: string
  current_value: bigint
}

async function nextSequenceValue(db: SqliteDatabase, sequenceName: string): Promise<bigint> {
  // Atomic increment using SQLite
  const result = await db.run(`
    UPDATE _gel_sequences
    SET current_value = current_value + 1
    WHERE name = ?
    RETURNING current_value
  `, [sequenceName])

  return BigInt(result.current_value)
}

// Schema migration creates:
// CREATE TABLE _gel_sequences (
//   name TEXT PRIMARY KEY,
//   current_value INTEGER NOT NULL DEFAULT 0
// );
```

### 16. Range Types

```typescript
// SQLite: TEXT (JSON object)
// JS: Range<T>

interface Range<T> {
  readonly lower: T | null      // null = unbounded
  readonly upper: T | null      // null = unbounded
  readonly inc_lower: boolean   // Include lower bound
  readonly inc_upper: boolean   // Include upper bound
  readonly empty: boolean       // Empty range
}

// Supported range types:
// - range<int32>, range<int64> - Discrete (normalized to [lower, upper))
// - range<float32>, range<float64>, range<decimal> - Contiguous
// - range<datetime>, range<cal::local_datetime>, range<cal::local_date>

function serializeRange<T>(
  range: Range<T>,
  serializeValue: (v: T) => unknown
): string {
  if (range.empty) {
    return JSON.stringify({ empty: true })
  }
  return JSON.stringify({
    lower: range.lower !== null ? serializeValue(range.lower) : null,
    upper: range.upper !== null ? serializeValue(range.upper) : null,
    inc_lower: range.inc_lower,
    inc_upper: range.inc_upper,
    empty: false
  })
}

function deserializeRange<T>(
  value: string,
  deserializeValue: (v: unknown) => T
): Range<T> {
  const obj = JSON.parse(value)
  if (obj.empty) {
    return { lower: null, upper: null, inc_lower: false, inc_upper: false, empty: true }
  }
  return {
    lower: obj.lower !== null ? deserializeValue(obj.lower) : null,
    upper: obj.upper !== null ? deserializeValue(obj.upper) : null,
    inc_lower: obj.inc_lower,
    inc_upper: obj.inc_upper,
    empty: false
  }
}

// Discrete range normalization (always [lower, upper))
function normalizeDiscreteRange<T extends number | bigint>(range: Range<T>): Range<T> {
  if (range.empty) return range

  let lower = range.lower
  let upper = range.upper

  // If lower is exclusive, increment it
  if (lower !== null && !range.inc_lower) {
    lower = (typeof lower === 'bigint' ? lower + BigInt(1) : lower + 1) as T
  }

  // If upper is inclusive, increment it
  if (upper !== null && range.inc_upper) {
    upper = (typeof upper === 'bigint' ? upper + BigInt(1) : upper + 1) as T
  }

  return { lower, upper, inc_lower: true, inc_upper: false, empty: false }
}
```

### 17. Multirange Types

```typescript
// SQLite: TEXT (JSON array of ranges)
// JS: MultiRange<T> (array of non-overlapping, ordered ranges)

type MultiRange<T> = readonly Range<T>[]

function serializeMultiRange<T>(
  multirange: MultiRange<T>,
  serializeValue: (v: T) => unknown
): string {
  return JSON.stringify(
    multirange.map(r => JSON.parse(serializeRange(r, serializeValue)))
  )
}

function deserializeMultiRange<T>(
  value: string,
  deserializeValue: (v: unknown) => T
): MultiRange<T> {
  const arr = JSON.parse(value)
  return arr.map((r: unknown) =>
    deserializeRange(JSON.stringify(r), deserializeValue)
  )
}
```

### 18. Array Type

```typescript
// SQLite: TEXT (JSON array)
// JS: T[]

function serializeArray<T>(
  value: T[],
  serializeElement: (v: T) => unknown
): string {
  return JSON.stringify(value.map(serializeElement))
}

function deserializeArray<T>(
  value: string,
  deserializeElement: (v: unknown) => T
): T[] {
  return JSON.parse(value).map(deserializeElement)
}
```

### 19. Tuple Type

```typescript
// SQLite: TEXT (JSON array)
// JS: [T1, T2, ...]

type TupleSerializers = readonly ((v: unknown) => unknown)[]

function serializeTuple(
  value: readonly unknown[],
  serializers: TupleSerializers
): string {
  if (value.length !== serializers.length) {
    throw new TypeError(`Tuple length mismatch: expected ${serializers.length}, got ${value.length}`)
  }
  return JSON.stringify(value.map((v, i) => serializers[i](v)))
}
```

---

## Cardinality Enforcement Strategy

EdgeDB tracks 5 cardinality levels:
- **Empty**: Zero elements (only in query results)
- **One**: Exactly one element (singleton)
- **AtMostOne**: Zero or one element (optional)
- **AtLeastOne**: One or more elements (required multi)
- **Many**: Any number of elements (optional multi)

### Schema Mapping

| EdgeDB Cardinality | SQLite Constraint | JS Type |
|--------------------|-------------------|---------|
| `required single` (One) | `NOT NULL` | `T` |
| `optional single` (AtMostOne) | nullable | `T \| null` |
| `required multi` (AtLeastOne) | Junction table + check | `T[]` (length >= 1) |
| `optional multi` (Many) | Junction table | `T[]` |

### Implementation Strategy

#### Single Properties (One/AtMostOne)

```sql
-- Required single: NOT NULL constraint
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- required single str
  email TEXT                    -- optional single str
);
```

#### Multi Properties (AtLeastOne/Many)

```sql
-- Multi properties use junction tables
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- optional multi (Many)
CREATE TABLE User_tags (
  user_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  _index INTEGER NOT NULL,      -- Preserves array order
  PRIMARY KEY (user_id, _index)
);

-- required multi (AtLeastOne) - enforced at runtime
-- SQLite doesn't support deferred constraints, so we validate in app layer
```

#### Runtime Validation

```typescript
interface CardinalityValidator {
  // Validate on INSERT/UPDATE
  validateRequired(value: unknown): void
  validateAtLeastOne(values: unknown[]): void
}

const cardinalityValidator: CardinalityValidator = {
  validateRequired(value: unknown): void {
    if (value === null || value === undefined) {
      throw new CardinalityError('Required property cannot be null')
    }
  },

  validateAtLeastOne(values: unknown[]): void {
    if (!Array.isArray(values) || values.length === 0) {
      throw new CardinalityError('Required multi property must have at least one value')
    }
  }
}

class CardinalityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardinalityError'
  }
}
```

#### Client-Side Deserialization

```typescript
// EdgeDB client behavior for empty sets:
// - Many/AtLeastOne: empty array []
// - AtMostOne: null
// - One: throws error (shouldn't happen with valid schema)

function deserializeCardinality<T>(
  values: T[],
  cardinality: 'One' | 'AtMostOne' | 'AtLeastOne' | 'Many'
): T | T[] | null {
  switch (cardinality) {
    case 'One':
      if (values.length !== 1) {
        throw new CardinalityError(`Expected exactly one value, got ${values.length}`)
      }
      return values[0]

    case 'AtMostOne':
      if (values.length > 1) {
        throw new CardinalityError(`Expected at most one value, got ${values.length}`)
      }
      return values.length === 0 ? null : values[0]

    case 'AtLeastOne':
      if (values.length === 0) {
        throw new CardinalityError('Expected at least one value, got none')
      }
      return values

    case 'Many':
      return values
  }
}
```

---

## Limitations and Risk Assessment

### High Risk (Precision/Data Loss)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| `int64` > 2^53 loses precision in JS number | Data corruption | Use `bigint` mode for large integers |
| `float32` stored as `float64` | Different bit representation | Document precision expansion |
| `decimal` has no native JS type | Calculations may be incorrect | Use string; recommend decimal.js |
| `duration` nanoseconds → microseconds | 1000x precision loss | Store as microseconds only |

### Medium Risk (Behavioral Differences)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Range normalization differs for discrete vs continuous | Query behavior may differ | Normalize on write for discrete ranges |
| Sequence atomicity across DOs | Gaps in sequence | Document DO isolation behavior |
| Timezone handling in `datetime` | Incorrect local times | Always use UTC internally |
| `AtLeastOne` cannot be enforced in SQLite | Invalid state possible | Runtime validation required |

### Low Risk (Cosmetic/Edge Cases)

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Empty multirange representation | Slightly different JSON | Normalize to empty array |
| Enum ordering | Comparison behavior | Document that enums are unordered in SQLite |
| UUID case sensitivity | Query issues | Always lowercase on store |

---

## SQLite Schema Generation

### Type Affinity Mapping

```typescript
const SQLITE_TYPE_MAP: Record<string, string> = {
  // Stored as INTEGER
  'bool': 'INTEGER',
  'int16': 'INTEGER',
  'int32': 'INTEGER',
  'int64': 'INTEGER',
  'sequence': 'INTEGER',

  // Stored as REAL
  'float32': 'REAL',
  'float64': 'REAL',

  // Stored as TEXT
  'str': 'TEXT',
  'uuid': 'TEXT',
  'bigint': 'TEXT',
  'decimal': 'TEXT',
  'json': 'TEXT',
  'datetime': 'TEXT',
  'duration': 'TEXT',
  'cal::local_date': 'TEXT',
  'cal::local_time': 'TEXT',
  'cal::local_datetime': 'TEXT',
  'cal::relative_duration': 'TEXT',
  'cal::date_duration': 'TEXT',
  'enum': 'TEXT',
  'array': 'TEXT',
  'tuple': 'TEXT',
  'range': 'TEXT',
  'multirange': 'TEXT',

  // Stored as BLOB
  'bytes': 'BLOB',
}
```

### Example Schema Migration

```typescript
// EdgeDB SDL:
// type User {
//   required name: str;
//   email: str;
//   age: int32;
//   balance: decimal;
//   tags: array<str>;
//   created_at: datetime;
// }

// Generated SQLite:
const createUserTable = `
CREATE TABLE User (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  email TEXT,
  age INTEGER,
  balance TEXT,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX User_name_idx ON User(name);
`;
```

---

## Testing Checklist

- [ ] Round-trip all scalar types through serialize/deserialize
- [ ] Validate int16/int32/int64 range enforcement
- [ ] Test bigint precision with values > 2^53
- [ ] Test decimal arbitrary precision
- [ ] Test datetime timezone handling (UTC normalization)
- [ ] Test duration parsing (ISO 8601)
- [ ] Test all three duration types differ correctly
- [ ] Test enum validation rejects invalid values
- [ ] Test sequence atomicity within single DO
- [ ] Test range normalization for discrete types
- [ ] Test multirange ordering and overlap handling
- [ ] Test array/tuple JSON round-trip
- [ ] Test cardinality enforcement (required, AtLeastOne)
- [ ] Test null handling for optional types
- [ ] Test bytes BLOB storage and retrieval
- [ ] Test UUID validation and case normalization

---

## References

- [EdgeDB Primitives Documentation](https://docs.geldata.com/database/datamodel/primitives)
- [EdgeDB Standard Library - Numbers](https://docs.edgedb.com/database/stdlib/numbers)
- [EdgeDB Standard Library - Datetime](https://docs.edgedb.com/database/stdlib/datetime)
- [EdgeDB Standard Library - Ranges](https://docs.edgedb.com/database/stdlib/range)
- [EdgeDB Cardinality Reference](https://docs.geldata.com/database/reference/edgeql/cardinality)
- [EdgeDB Binary Protocol - Data Wire Formats](https://docs.edgedb.com/database/reference/protocol/dataformats)
- [SQLite Data Types](https://www.sqlite.org/datatype3.html)

---

## Next Steps

1. **Phase 2 (RED)**: Write failing tests for all type mappings (dotdo-genky)
2. **Phase 3 (GREEN)**: Implement TypeSystem class with serializers/deserializers
3. **Phase 4 (REFACTOR)**: Optimize JSON serialization, add validation caching
4. Create TypeScript type definitions matching EdgeDB's type inference
