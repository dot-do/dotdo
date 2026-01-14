/**
 * Error formatting utilities for CLI
 */

/**
 * CLI error with command context
 */
export interface CLIError {
  command: string
  message: string
  path?: string
  code?: string
}

/**
 * Extract error code from error object if available
 */
function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code)
  }
  return undefined
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

/**
 * Format error for CLI output with consistent styling
 *
 * Format: fsx <command>: <message>
 */
export function formatError(command: string, err: unknown): string {
  const message = getErrorMessage(err)
  return `fsx ${command}: ${message}`
}

/**
 * Create a missing argument error message
 */
export function missingArgumentError(command: string, argName: string): string {
  return `fsx ${command}: missing ${argName} argument`
}

/**
 * Create an unknown command error message
 */
export function unknownCommandError(command: string): string {
  return `fsx: unknown command '${command}'`
}
