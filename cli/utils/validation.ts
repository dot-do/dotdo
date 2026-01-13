/**
 * Validation Utilities
 *
 * Common validation functions for CLI commands.
 */

/**
 * Parse and validate a port number from a string.
 *
 * @param value - The string value to parse as a port number
 * @returns The parsed port number
 * @throws Error if the value is not a valid port (1-65535)
 *
 * @example
 * parsePort('4000')  // Returns 4000
 * parsePort('abc')   // Throws: Invalid port: "abc" - must be a number between 1 and 65535
 * parsePort('0')     // Throws: Invalid port: "0" - must be a number between 1 and 65535
 */
export function parsePort(value: string): number {
  // Check that the entire string is numeric (no trailing characters)
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid port: "${value}" - must be a number between 1 and 65535`)
  }
  const port = parseInt(value, 10)
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: "${value}" - must be a number between 1 and 65535`)
  }
  return port
}
