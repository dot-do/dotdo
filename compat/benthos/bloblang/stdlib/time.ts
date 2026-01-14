/**
 * Bloblang Date/Time Stdlib Functions
 * Issue: dotdo-dovwd
 *
 * Implementation of date/time parsing and formatting functions for Bloblang compatibility.
 * Uses Go's time format layout (reference time: Mon Jan 2 15:04:05 MST 2006).
 */

/**
 * Go time format reference values and their meanings:
 * 2006 - Year (4 digit)
 * 06   - Year (2 digit)
 * 01   - Month (2 digit, zero-padded)
 * 1    - Month (no padding)
 * Jan  - Month (abbreviated name)
 * January - Month (full name)
 * 02   - Day (2 digit, zero-padded)
 * 2    - Day (no padding)
 * Mon  - Day of week (abbreviated)
 * Monday - Day of week (full name)
 * 15   - Hour (24-hour, zero-padded)
 * 03   - Hour (12-hour, zero-padded)
 * 3    - Hour (12-hour, no padding)
 * 04   - Minute (zero-padded)
 * 05   - Second (zero-padded)
 * .000 - Milliseconds
 * .000000 - Microseconds
 * .000000000 - Nanoseconds
 * PM/pm - AM/PM indicator
 * MST  - Timezone abbreviation
 * Z07:00 - Timezone offset (Z for UTC, or +HH:MM)
 * -07:00 - Timezone offset (always show sign)
 */

// Duration unit multipliers in nanoseconds
const NANOSECOND = 1
const MICROSECOND = 1000 * NANOSECOND
const MILLISECOND = 1000 * MICROSECOND
const SECOND = 1000 * MILLISECOND
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Duration unit regex pattern
const DURATION_REGEX = /^(-)?(?:(\d+(?:\.\d+)?)(d|h|m(?:s)?|s|us|\xb5s|ns))+$/

// Month names
const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

const DAY_NAMES_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]

const DAY_NAMES_SHORT = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
]

/**
 * Parse a Go-style duration string into nanoseconds.
 * Supports: d, h, m, s, ms, us/\u00b5s, ns
 * Examples: "1h30m", "500ms", "2h45m30s"
 */
export function parse_duration(duration: string): number {
  if (!duration || typeof duration !== 'string') {
    throw new Error(`parse_duration: invalid duration string`)
  }

  // Parse the duration string
  let isNegative = false
  let remaining = duration

  if (remaining.startsWith('-')) {
    isNegative = true
    remaining = remaining.slice(1)
  }

  if (remaining.length === 0) {
    throw new Error(`parse_duration: invalid duration string "${duration}"`)
  }

  let totalNanos = 0
  const unitPattern = /(\d+(?:\.\d+)?)(d|h|m(?:s)?|s|us|\xb5s|ns)/g
  let match: RegExpExecArray | null
  let lastIndex = 0

  while ((match = unitPattern.exec(remaining)) !== null) {
    // Check for gaps in parsing
    if (match.index !== lastIndex) {
      throw new Error(`parse_duration: invalid duration string "${duration}"`)
    }
    lastIndex = unitPattern.lastIndex

    const value = parseFloat(match[1])
    const unit = match[2]

    let multiplier: number
    switch (unit) {
      case 'd':
        multiplier = DAY
        break
      case 'h':
        multiplier = HOUR
        break
      case 'm':
        multiplier = MINUTE
        break
      case 's':
        multiplier = SECOND
        break
      case 'ms':
        multiplier = MILLISECOND
        break
      case 'us':
      case '\u00b5s':
        multiplier = MICROSECOND
        break
      case 'ns':
        multiplier = NANOSECOND
        break
      default:
        throw new Error(`parse_duration: unknown unit "${unit}"`)
    }

    totalNanos += value * multiplier
  }

  // Check that we consumed the entire string
  if (lastIndex !== remaining.length) {
    throw new Error(`parse_duration: invalid duration string "${duration}"`)
  }

  return isNegative ? -totalNanos : totalNanos
}

/**
 * Go format tokens - defined in order of matching priority (longer first)
 * Each token is [goPattern, jsPattern]
 */
const GO_FORMAT_TOKENS: [string, string][] = [
  // Longer patterns first to avoid partial matches
  ['January', 'MMMM'],     // Full month name
  ['Monday', 'EEEE'],      // Full day name
  ['2006', 'yyyy'],        // 4-digit year
  ['Z07:00', 'XXX'],       // Timezone offset (Z for UTC)
  ['-07:00', 'xxx'],       // Timezone offset (always show sign)
  ['-0700', 'xx'],         // Timezone offset without colon
  ['.000000000', '.SSSSSSSSS'], // Nanoseconds
  ['.000000', '.SSSSSS'],  // Microseconds
  ['.000', '.SSS'],        // Milliseconds
  ['Jan', 'MMM'],          // Abbreviated month name
  ['Mon', 'EEE'],          // Abbreviated day name
  ['MST', 'zzz'],          // Timezone abbreviation
  ['06', 'yy'],            // 2-digit year
  ['01', 'MM'],            // Zero-padded month
  ['02', 'dd'],            // Zero-padded day
  ['15', 'HH'],            // 24-hour (zero-padded)
  ['03', 'hh'],            // 12-hour (zero-padded)
  ['04', 'mm'],            // Minutes (zero-padded)
  ['05', 'ss'],            // Seconds (zero-padded)
  ['PM', 'a'],             // AM/PM uppercase
  ['pm', 'a'],             // AM/PM lowercase
  // Single digit patterns - must be matched with word boundaries
  ['1', 'M'],              // Month without padding
  ['2', 'd'],              // Day without padding
  ['3', 'h'],              // 12-hour (no padding)
]

/**
 * JS format tokens - reverse mapping
 */
const JS_FORMAT_TOKENS: [string, string][] = [
  ['MMMM', 'January'],
  ['EEEE', 'Monday'],
  ['yyyy', '2006'],
  ['XXX', 'Z07:00'],
  ['xxx', '-07:00'],
  ['xx', '-0700'],
  ['.SSSSSSSSS', '.000000000'],
  ['.SSSSSS', '.000000'],
  ['.SSS', '.000'],
  ['MMM', 'Jan'],
  ['EEE', 'Mon'],
  ['zzz', 'MST'],
  ['yy', '06'],
  ['MM', '01'],
  ['dd', '02'],
  ['HH', '15'],
  ['hh', '03'],
  ['mm', '04'],
  ['ss', '05'],
  ['a', 'PM'],
  ['M', '1'],
  ['d', '2'],
  ['h', '3'],
]

/**
 * Convert Go time format to a more standard format for JavaScript
 * Uses tokenization to avoid incorrect substring replacements
 */
export function goFormatToJS(goFormat: string): string {
  return tokenizedReplace(goFormat, GO_FORMAT_TOKENS)
}

/**
 * Convert JS format back to Go format
 */
export function jsFormatToGo(jsFormat: string): string {
  return tokenizedReplace(jsFormat, JS_FORMAT_TOKENS)
}

/**
 * Tokenized replacement - finds tokens in order and replaces them
 * This avoids issues with partial matches (e.g., '1' in '01')
 */
function tokenizedReplace(input: string, tokens: [string, string][]): string {
  // Build a combined regex that matches any token
  // Use capturing groups and track which token matched
  let result = ''
  let pos = 0

  while (pos < input.length) {
    let matched = false

    // Try to match each token at the current position
    for (const [pattern, replacement] of tokens) {
      if (input.startsWith(pattern, pos)) {
        result += replacement
        pos += pattern.length
        matched = true
        break
      }
    }

    if (!matched) {
      // No token matched - copy the character as-is
      result += input[pos]
      pos++
    }
  }

  return result
}

/**
 * Parse a timestamp string using Go time format.
 * Special formats: "unix" (Unix seconds), "unix_milli" (Unix milliseconds)
 */
export function ts_parse(format: string, value: string): Date {
  if (value === null || value === undefined) {
    throw new Error(`ts_parse: value cannot be null or undefined`)
  }

  if (typeof value !== 'string') {
    throw new Error(`ts_parse: value must be a string, got ${typeof value}`)
  }

  // Handle special formats
  if (format === 'unix') {
    const seconds = parseInt(value, 10)
    if (isNaN(seconds)) {
      throw new Error(`ts_parse: invalid Unix timestamp "${value}"`)
    }
    return new Date(seconds * 1000)
  }

  if (format === 'unix_milli') {
    const millis = parseInt(value, 10)
    if (isNaN(millis)) {
      throw new Error(`ts_parse: invalid Unix milliseconds timestamp "${value}"`)
    }
    return new Date(millis)
  }

  // Try parsing as ISO 8601 first for common formats
  if (format.includes('2006-01-02') && format.includes('15:04:05')) {
    // Try direct ISO parsing
    const isoDate = new Date(value)
    if (!isNaN(isoDate.getTime())) {
      return isoDate
    }
  }

  // Parse using Go format
  return parseGoFormat(format, value)
}

/**
 * Parse a date string using Go time format
 * Uses tokenized approach to build regex pattern
 */
function parseGoFormat(format: string, value: string): Date {
  // Define tokens with their regex patterns and type names
  // Order by length (longer first) to avoid partial matches
  const tokens: [string, string, string][] = [
    // Longer patterns first
    ['January', `(${MONTH_NAMES_FULL.join('|')})`, 'monthFull'],
    ['Monday', `(${DAY_NAMES_FULL.join('|')})`, 'dayNameFull'],
    ['2006', '(\\d{4})', 'year4'],
    ['Z07:00', '(Z|[+-]\\d{2}:\\d{2})', 'tzZ'],
    ['-07:00', '([+-]\\d{2}:\\d{2})', 'tzOffset'],
    ['-0700', '([+-]\\d{4})', 'tzOffsetNoColon'],
    ['.000000000', '\\.(\\d{9})', 'nano'],
    ['.000000', '\\.(\\d{6})', 'micro'],
    ['.000', '\\.(\\d{3})', 'milli'],
    ['Jan', `(${MONTH_NAMES_SHORT.join('|')})`, 'monthShort'],
    ['Mon', `(${DAY_NAMES_SHORT.join('|')})`, 'dayNameShort'],
    ['MST', '([A-Z]{3,4})', 'tzAbbr'],
    ['06', '(\\d{2})', 'year2'],
    ['01', '(\\d{2})', 'month2'],
    ['02', '(\\d{2})', 'day2'],
    ['15', '(\\d{2})', 'hour24'],
    ['03', '(\\d{2})', 'hour12'],
    ['04', '(\\d{2})', 'minute'],
    ['05', '(\\d{2})', 'second'],
    ['PM', '(AM|PM)', 'ampm'],
    ['pm', '(am|pm)', 'ampmLower'],
    // Single digit patterns last
    ['1', '(\\d{1,2})', 'month1'],
    ['2', '(\\d{1,2})', 'day1'],
    ['3', '(\\d{1,2})', 'hour12ns'],
  ]

  // Build regex pattern using tokenized approach
  let pattern = ''
  const extractors: Array<{ type: string; index: number }> = []
  let groupIndex = 1
  let pos = 0

  while (pos < format.length) {
    let matched = false

    // Try to match each token at the current position
    for (const [token, regex, type] of tokens) {
      if (format.startsWith(token, pos)) {
        pattern += regex
        extractors.push({ type, index: groupIndex })
        groupIndex++
        pos += token.length
        matched = true
        break
      }
    }

    if (!matched) {
      // No token matched - escape special regex chars and copy as literal
      const char = format[pos]
      if ('.?*+^$[]\\(){}|-'.includes(char)) {
        pattern += '\\' + char
      } else {
        pattern += char
      }
      pos++
    }
  }

  // Try to match
  const regex = new RegExp('^' + pattern + '$')
  const match = value.match(regex)

  if (!match) {
    throw new Error(`ts_parse: value "${value}" does not match format "${format}"`)
  }

  // Extract components
  const now = new Date()
  let year = now.getFullYear()
  let month = 0 // 0-indexed
  let day = 1
  let hour = 0
  let minute = 0
  let second = 0
  let millisecond = 0
  let tzOffsetMinutes = 0
  let isPM = false
  let is12Hour = false

  for (const extractor of extractors) {
    const val = match[extractor.index]

    switch (extractor.type) {
      case 'year4':
        year = parseInt(val, 10)
        break
      case 'year2':
        year = 2000 + parseInt(val, 10)
        break
      case 'monthFull':
        month = MONTH_NAMES_FULL.indexOf(val)
        break
      case 'monthShort':
        month = MONTH_NAMES_SHORT.indexOf(val)
        break
      case 'month2':
      case 'month1':
        month = parseInt(val, 10) - 1
        break
      case 'dayNameFull':
      case 'dayNameShort':
        // Day of week is informational only, not used for parsing
        break
      case 'day2':
      case 'day1':
        day = parseInt(val, 10)
        break
      case 'hour24':
        hour = parseInt(val, 10)
        break
      case 'hour12':
      case 'hour12ns':
        hour = parseInt(val, 10)
        is12Hour = true
        break
      case 'minute':
        minute = parseInt(val, 10)
        break
      case 'second':
        second = parseInt(val, 10)
        break
      case 'milli':
        millisecond = parseInt(val, 10)
        break
      case 'micro':
        millisecond = Math.floor(parseInt(val, 10) / 1000)
        break
      case 'nano':
        millisecond = Math.floor(parseInt(val, 10) / 1000000)
        break
      case 'tzZ':
        if (val === 'Z') {
          tzOffsetMinutes = 0
        } else {
          tzOffsetMinutes = parseTzOffset(val)
        }
        break
      case 'tzOffset':
        tzOffsetMinutes = parseTzOffset(val)
        break
      case 'tzOffsetNoColon':
        tzOffsetMinutes = parseTzOffsetNoColon(val)
        break
      case 'tzAbbr':
        // Timezone abbreviations are ambiguous, assume UTC for MST pattern
        break
      case 'ampm':
        isPM = val === 'PM'
        break
      case 'ampmLower':
        isPM = val === 'pm'
        break
    }
  }

  // Handle 12-hour to 24-hour conversion
  if (is12Hour) {
    if (isPM && hour !== 12) {
      hour += 12
    } else if (!isPM && hour === 12) {
      hour = 0
    }
  }

  // Create date in UTC, then adjust for timezone offset
  const date = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond))

  // Adjust for timezone offset (subtract because offset is "from UTC")
  if (tzOffsetMinutes !== 0) {
    date.setTime(date.getTime() - tzOffsetMinutes * 60 * 1000)
  }

  return date
}

/**
 * Parse timezone offset string like "+05:00" or "-07:00"
 */
function parseTzOffset(offset: string): number {
  const match = offset.match(/([+-])(\d{2}):(\d{2})/)
  if (!match) return 0

  const sign = match[1] === '+' ? 1 : -1
  const hours = parseInt(match[2], 10)
  const minutes = parseInt(match[3], 10)

  return sign * (hours * 60 + minutes)
}

/**
 * Parse timezone offset string without colon like "+0500" or "-0700"
 */
function parseTzOffsetNoColon(offset: string): number {
  const match = offset.match(/([+-])(\d{2})(\d{2})/)
  if (!match) return 0

  const sign = match[1] === '+' ? 1 : -1
  const hours = parseInt(match[2], 10)
  const minutes = parseInt(match[3], 10)

  return sign * (hours * 60 + minutes)
}

/**
 * Convert a timestamp to the specified Go time format string.
 * Special formats: "unix" (Unix seconds), "unix_milli" (Unix milliseconds)
 */
export function ts_format(timestamp: Date | number | string, format: string): string {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_format: invalid date`)
  }

  // Handle special formats
  if (format === 'unix') {
    return String(Math.floor(date.getTime() / 1000))
  }

  if (format === 'unix_milli') {
    return String(date.getTime())
  }

  return formatGoDate(date, format)
}

/**
 * Format a date using Go time format
 * Uses tokenized replacement to avoid incorrect substring replacements
 */
function formatGoDate(date: Date, format: string): string {
  // Get date components (UTC)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const dayOfWeek = date.getUTCDay()
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const seconds = date.getUTCSeconds()
  const milliseconds = date.getUTCMilliseconds()

  // 12-hour format
  const hours12 = hours % 12 || 12
  const ampm = hours < 12 ? 'AM' : 'PM'

  // Build replacement map (tokens in order of priority - longer first)
  const replacements: [string, string][] = [
    // Longer patterns first
    ['January', MONTH_NAMES_FULL[month]],
    ['Monday', DAY_NAMES_FULL[dayOfWeek]],
    ['2006', String(year)],
    ['Z07:00', 'Z'], // UTC
    ['-07:00', '+00:00'], // UTC offset
    ['-0700', '+0000'], // UTC offset without colon
    ['.000000000', '.' + String(milliseconds).padStart(3, '0') + '000000'], // Nanoseconds
    ['.000000', '.' + String(milliseconds).padStart(3, '0') + '000'], // Microseconds
    ['.000', '.' + String(milliseconds).padStart(3, '0')], // Milliseconds
    ['Jan', MONTH_NAMES_SHORT[month]],
    ['Mon', DAY_NAMES_SHORT[dayOfWeek]],
    ['MST', 'UTC'], // Timezone abbreviation
    ['06', String(year).slice(-2)],
    ['01', String(month + 1).padStart(2, '0')],
    ['02', String(day).padStart(2, '0')],
    ['15', String(hours).padStart(2, '0')],
    ['03', String(hours12).padStart(2, '0')],
    ['04', String(minutes).padStart(2, '0')],
    ['05', String(seconds).padStart(2, '0')],
    ['PM', ampm],
    ['pm', ampm.toLowerCase()],
    // Single-digit patterns last
    ['1', String(month + 1)],
    ['2', String(day)],
    ['3', String(hours12)],
  ]

  return tokenizedReplace(format, replacements)
}

/**
 * Convert timestamp to Unix seconds
 */
export function ts_unix(timestamp: Date | number | string): number {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_unix: invalid timestamp`)
  }

  return Math.floor(date.getTime() / 1000)
}

/**
 * Convert timestamp to Unix milliseconds
 */
export function ts_unix_milli(timestamp: Date | number | string): number {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_unix_milli: invalid timestamp`)
  }

  return date.getTime()
}

/**
 * Convert timestamp to Unix nanoseconds (returns bigint for precision)
 */
export function ts_unix_nano(timestamp: Date | number | string): bigint {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_unix_nano: invalid timestamp`)
  }

  // JavaScript Date only has millisecond precision
  // We multiply by 1000000 to convert ms to ns
  return BigInt(date.getTime()) * BigInt(1000000)
}

/**
 * Add duration to timestamp
 */
export function ts_add(timestamp: Date | number | string, duration: string | number): Date {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_add: invalid timestamp`)
  }

  // Parse duration if string, otherwise treat as nanoseconds
  const durationNanos = typeof duration === 'string'
    ? parse_duration(duration)
    : duration

  // Convert nanoseconds to milliseconds for Date arithmetic
  const durationMs = durationNanos / 1000000

  return new Date(date.getTime() + durationMs)
}

/**
 * Subtract duration from timestamp
 */
export function ts_sub(timestamp: Date | number | string, duration: string | number): Date {
  const date = toDate(timestamp)

  if (isNaN(date.getTime())) {
    throw new Error(`ts_sub: invalid timestamp`)
  }

  // Parse duration if string, otherwise treat as nanoseconds
  const durationNanos = typeof duration === 'string'
    ? parse_duration(duration)
    : duration

  // Convert nanoseconds to milliseconds for Date arithmetic
  const durationMs = durationNanos / 1000000

  return new Date(date.getTime() - durationMs)
}

/**
 * Helper: Convert various timestamp types to Date
 */
function toDate(timestamp: Date | number | string): Date {
  if (timestamp instanceof Date) {
    return timestamp
  }

  if (typeof timestamp === 'number') {
    // Assume milliseconds (like JavaScript Date.getTime())
    return new Date(timestamp)
  }

  if (typeof timestamp === 'string') {
    const parsed = new Date(timestamp)
    if (isNaN(parsed.getTime())) {
      throw new Error(`ts_*: cannot parse timestamp string "${timestamp}"`)
    }
    return parsed
  }

  throw new Error(`ts_*: invalid timestamp type ${typeof timestamp}`)
}

/**
 * Time functions object for method-style registration
 */
export const timeFunctions = {
  parse_duration: {
    call(value: unknown): number {
      if (typeof value !== 'string') {
        throw new TypeError(`parse_duration expects a string, got ${typeof value}`)
      }
      return parse_duration(value)
    }
  },

  ts_parse: {
    call(format: unknown, value: unknown): Date {
      if (typeof format !== 'string') {
        throw new TypeError(`ts_parse format must be a string, got ${typeof format}`)
      }
      if (typeof value !== 'string') {
        throw new TypeError(`ts_parse value must be a string, got ${typeof value}`)
      }
      return ts_parse(format, value)
    }
  },

  ts_format: {
    call(timestamp: unknown, format: unknown): string {
      if (typeof format !== 'string') {
        throw new TypeError(`ts_format format must be a string, got ${typeof format}`)
      }
      return ts_format(timestamp as Date | number | string, format)
    }
  },

  ts_unix: {
    call(timestamp: unknown): number {
      return ts_unix(timestamp as Date | number | string)
    }
  },

  ts_unix_milli: {
    call(timestamp: unknown): number {
      return ts_unix_milli(timestamp as Date | number | string)
    }
  },

  ts_unix_nano: {
    call(timestamp: unknown): bigint {
      return ts_unix_nano(timestamp as Date | number | string)
    }
  },

  ts_add: {
    call(timestamp: unknown, duration: unknown): Date {
      return ts_add(
        timestamp as Date | number | string,
        duration as string | number
      )
    }
  },

  ts_sub: {
    call(timestamp: unknown, duration: unknown): Date {
      return ts_sub(
        timestamp as Date | number | string,
        duration as string | number
      )
    }
  },
}
