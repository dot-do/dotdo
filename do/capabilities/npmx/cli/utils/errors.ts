/**
 * Error formatting utilities for CLI
 */

/**
 * CLI error with command context
 */
export interface CLIError {
  command: string
  message: string
  package?: string
  code?: string
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
 * Format: npmx <command>: <message>
 */
export function formatError(command: string, err: unknown): string {
  const message = getErrorMessage(err)
  return `npmx ${command}: ${message}`
}

/**
 * Create a missing argument error message
 */
export function missingArgumentError(command: string, argName: string): string {
  return `npmx ${command}: missing ${argName} argument`
}

/**
 * Create an unknown command error message
 */
export function unknownCommandError(command: string): string {
  return `npmx: unknown command '${command}'`
}

/**
 * Create a package not found error message
 */
export function packageNotFoundError(name: string): string {
  return `npmx: package '${name}' not found`
}

/**
 * Create a version not found error message
 */
export function versionNotFoundError(name: string, version: string): string {
  return `npmx: version '${version}' not found for package '${name}'`
}
