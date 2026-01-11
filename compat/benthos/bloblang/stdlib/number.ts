/**
 * Bloblang Number Stdlib Functions
 * Issue: dotdo-et4kb (Milestone 2)
 *
 * Implementation of number manipulation and conversion functions
 */

/**
 * abs() - Returns absolute value of a number
 */
export function abs(value: number): number {
  return Math.abs(value)
}

/**
 * ceil() - Rounds up to nearest integer
 */
export function ceil(value: number): number {
  const result = Math.ceil(value)
  // Normalize -0 to 0
  return result === 0 ? 0 : result
}

/**
 * floor() - Rounds down to nearest integer
 */
export function floor(value: number): number {
  return Math.floor(value)
}

/**
 * round() - Rounds to nearest integer
 * For ties (.5), rounds away from zero
 */
export function round(value: number): number {
  // Handle special cases
  if (isNaN(value)) return NaN
  if (!isFinite(value)) return value

  // Round half away from zero
  if (value >= 0) {
    const result = Math.floor(value + 0.5)
    // Normalize -0 to 0
    return result === 0 ? 0 : result
  } else {
    const result = Math.ceil(value - 0.5)
    // Normalize -0 to 0
    return result === 0 ? 0 : result
  }
}

/**
 * max() - Returns maximum of two numbers
 */
export function max(a: number, b: number): number {
  return Math.max(a, b)
}

/**
 * min() - Returns minimum of two numbers
 */
export function min(a: number, b: number): number {
  return Math.min(a, b)
}

/**
 * sum() - Sums all elements in an array
 */
export function sum(array: number[]): number {
  return array.reduce((acc, val) => acc + val, 0)
}

/**
 * number() - Converts value to number
 */
export function number(value: any): number {
  // Special handling for arrays and empty strings to return NaN
  if (Array.isArray(value)) {
    return NaN
  }
  if (value === '') {
    return NaN
  }
  return Number(value)
}

/**
 * parseInteger() - Parses string to integer with optional base
 */
export function parseInteger(value: any, base?: number): number {
  // If it's already a number
  if (typeof value === 'number') {
    // Return NaN for Infinity
    if (!isFinite(value)) {
      return NaN
    }
    // Truncate finite numbers
    return Math.trunc(value)
  }

  // Parse string with parseInt
  return parseInt(String(value), base)
}

/**
 * parseFloat() - Parses string to float
 * Exported as parseFloatFn to avoid conflict with global parseFloat
 */
export function parseFloat(value: any): number {
  // If it's already a number, return as-is
  if (typeof value === 'number') {
    return value
  }

  // Parse string
  return globalThis.parseFloat(String(value))
}

/**
 * randomInt() - Generates random integer in range [min, max] inclusive
 */
export function randomInt(min: number, max: number): number {
  // Round inputs to integers
  let minInt = Math.round(min)
  let maxInt = Math.round(max)

  // Swap if min > max
  if (minInt > maxInt) {
    [minInt, maxInt] = [maxInt, minInt]
  }

  // Generate random integer in range [min, max] inclusive
  return Math.floor(Math.random() * (maxInt - minInt + 1)) + minInt
}
