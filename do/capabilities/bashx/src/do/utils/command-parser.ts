/**
 * @fileoverview Shell command parsing utilities
 *
 * This module provides utilities for parsing shell commands including:
 * - Command name extraction (handling env vars, paths)
 * - Argument extraction (respecting quotes)
 * - Tokenization (handling quotes and escapes)
 * - Quote stripping (handling escape sequences)
 * - Pipeline detection (ignoring pipes in quotes)
 *
 * All functions are pure and stateless, suitable for use by any executor.
 *
 * @example
 * ```ts
 * import { extractCommandName, extractArgs, hasPipeline } from './utils/command-parser'
 *
 * const cmd = 'VAR=value /usr/bin/node script.js --port 3000'
 * extractCommandName(cmd) // 'node'
 * extractArgs(cmd) // ['script.js', '--port', '3000']
 * hasPipeline(cmd) // false
 * ```
 */

/**
 * Regex to match environment variable assignments at the start of a command.
 * Matches patterns like: VAR=value, PATH=/usr/bin, MY_VAR=123
 */
const ENV_VAR_PREFIX_REGEX = /^(\w+=\S+\s+)+/

/**
 * Regex to match the command name (first word after env vars).
 * Matches word chars, hyphens, dots, and slashes (for paths).
 */
const COMMAND_NAME_REGEX = /^[\w\-.\/]+/

/**
 * Remove environment variable assignments from the start of a command.
 *
 * @param command - The full command string
 * @returns The command without leading env var assignments
 *
 * @example
 * ```ts
 * removeEnvVarsPrefix('VAR=value npm install') // 'npm install'
 * removeEnvVarsPrefix('A=1 B=2 node app.js') // 'node app.js'
 * removeEnvVarsPrefix('npm install') // 'npm install'
 * ```
 */
export function removeEnvVarsPrefix(command: string): string {
  const trimmed = command.trim()
  return trimmed.replace(ENV_VAR_PREFIX_REGEX, '')
}

/**
 * Parse environment variable assignments from the start of a command.
 *
 * @param command - The full command string
 * @returns An object mapping variable names to values
 *
 * @example
 * ```ts
 * parseEnvVars('VAR=value cmd') // { VAR: 'value' }
 * parseEnvVars('A=1 B=2 cmd') // { A: '1', B: '2' }
 * parseEnvVars('cmd') // {}
 * ```
 */
export function parseEnvVars(command: string): Record<string, string> {
  const trimmed = command.trim()
  const match = trimmed.match(ENV_VAR_PREFIX_REGEX)
  if (!match) return {}

  const envPart = match[0].trim()
  const result: Record<string, string> = {}

  // Split by whitespace and parse each assignment
  const assignments = envPart.split(/\s+/)
  for (const assignment of assignments) {
    const eqIndex = assignment.indexOf('=')
    if (eqIndex > 0) {
      const name = assignment.slice(0, eqIndex)
      const value = assignment.slice(eqIndex + 1)
      result[name] = value
    }
  }

  return result
}

/**
 * Extract the command name from a full command string.
 *
 * Handles:
 * - Environment variable prefixes (VAR=value cmd)
 * - Absolute paths (/usr/bin/bash -> bash)
 * - Relative paths (./scripts/run.sh -> run.sh)
 * - Hyphenated commands (aws-cli)
 * - Dotted commands (node.exe)
 *
 * @param command - The full command string
 * @returns The command name (basename if path), or empty string if not found
 *
 * @example
 * ```ts
 * extractCommandName('echo hello') // 'echo'
 * extractCommandName('VAR=value npm install') // 'npm'
 * extractCommandName('/usr/bin/bash -c "cmd"') // 'bash'
 * extractCommandName('./run.sh') // 'run.sh'
 * ```
 */
export function extractCommandName(command: string): string {
  const trimmed = command.trim()
  if (!trimmed) return ''

  // Remove env vars prefix
  const withoutEnvVars = removeEnvVarsPrefix(trimmed)
  if (!withoutEnvVars) return ''

  // Get first word (may include path separators)
  const match = withoutEnvVars.match(COMMAND_NAME_REGEX)
  if (!match) return ''

  // Extract basename if it's a path
  const fullName = match[0]
  const basename = fullName.split('/').pop() || ''

  return basename
}

/**
 * Extract arguments from a full command string.
 *
 * The command name is not included in the result.
 * Respects quotes and escape sequences.
 *
 * @param command - The full command string
 * @returns Array of arguments (quotes stripped)
 *
 * @example
 * ```ts
 * extractArgs('ls -la /tmp') // ['-la', '/tmp']
 * extractArgs('echo "hello world"') // ['hello world']
 * extractArgs('VAR=value npm install express') // ['install', 'express']
 * ```
 */
export function extractArgs(command: string): string[] {
  const trimmed = command.trim()
  if (!trimmed) return []

  // Remove env vars prefix
  const withoutEnvVars = removeEnvVarsPrefix(trimmed)
  if (!withoutEnvVars) return []

  // Tokenize the command
  const parts = tokenize(withoutEnvVars)

  // Skip the command name (first token)
  return parts.slice(1)
}

/**
 * Tokenize a command string, respecting quotes and escape sequences.
 *
 * This function splits a command into tokens (words), keeping quoted
 * strings together and handling escape sequences within double quotes.
 *
 * Rules:
 * - Whitespace outside quotes separates tokens
 * - Single quotes preserve everything literally
 * - Double quotes keep escape sequences for later processing by stripQuotes
 * - Adjacent quoted/unquoted parts form a single token
 *
 * @param input - The command string to tokenize
 * @returns Array of tokens with quotes stripped
 *
 * @example
 * ```ts
 * tokenize('echo hello world') // ['echo', 'hello', 'world']
 * tokenize('echo "hello world"') // ['echo', 'hello world']
 * tokenize("echo 'single quotes'") // ['echo', 'single quotes']
 * tokenize('echo "say \\"hello\\""') // ['echo', 'say "hello"']
 * ```
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    // Handle escape sequences in double quotes - keep them for stripQuotes to process
    if (char === '\\' && inDoubleQuote && i + 1 < input.length) {
      const nextChar = input[i + 1]
      // Keep the escape sequence for later processing
      current += char + nextChar
      i++ // Skip the escaped character
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
    } else if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(stripQuotes(current))
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(stripQuotes(current))
  }

  return tokens
}

/**
 * Strip outer quotes from a string and unescape inner quotes.
 *
 * This function matches the TieredExecutor behavior:
 * - Double quotes: outer quotes removed, \" unescaped to "
 * - Single quotes: outer quotes removed (no escaping in single quotes)
 * - Other strings: returned as-is
 *
 * @param s - The string to process
 * @returns The string with outer quotes stripped and escapes processed
 *
 * @example
 * ```ts
 * stripQuotes('"hello world"') // 'hello world'
 * stripQuotes("'hello world'") // 'hello world'
 * stripQuotes('"say \\"hi\\""') // 'say "hi"'
 * stripQuotes("'path\\to\\file'") // 'path\\to\\file' (preserved)
 * ```
 */
export function stripQuotes(s: string): string {
  // Need at least 2 characters to have opening and closing quotes
  if (s.length < 2) return s

  if (s.startsWith('"') && s.endsWith('"')) {
    // Remove outer double quotes and unescape inner escaped quotes
    return s.slice(1, -1).replace(/\\"/g, '"')
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    // Remove outer single quotes (no escaping in single quotes)
    return s.slice(1, -1)
  }
  return s
}

/**
 * Check if a command contains a shell pipeline (| outside of quotes).
 *
 * This function detects pipes that are not inside quoted strings,
 * which indicate a shell pipeline that needs special handling.
 *
 * Note: This implementation detects any standalone | outside quotes.
 * It does NOT treat || (logical OR) as a pipeline.
 *
 * @param command - The command string to check
 * @returns true if the command contains a pipeline, false otherwise
 *
 * @example
 * ```ts
 * hasPipeline('cat file | grep pattern') // true
 * hasPipeline('echo hello') // false
 * hasPipeline('echo "hello | world"') // false (pipe is quoted)
 * hasPipeline('cmd1 || cmd2') // false (logical OR, not pipe)
 * ```
 */
export function hasPipeline(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    // Handle escape in double quotes
    if (char === '\\' && inDoubleQuote && i + 1 < command.length) {
      i++ // Skip escaped character
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      // Check if it's not || (logical OR)
      const nextChar = i + 1 < command.length ? command[i + 1] : ''
      if (nextChar !== '|') {
        return true
      }
      // Skip the second | in ||
      i++
    }
  }

  return false
}

/**
 * Split a pipeline into individual commands.
 *
 * This function splits a command string by pipe operators,
 * respecting quotes. It does not split on || (logical OR).
 *
 * @param command - The pipeline command string
 * @returns Array of individual commands in the pipeline
 *
 * @example
 * ```ts
 * splitPipeline('cat file | grep pattern | wc -l')
 * // ['cat file', 'grep pattern', 'wc -l']
 *
 * splitPipeline('echo "hello | world"')
 * // ['echo "hello | world"'] (no split, pipe is quoted)
 * ```
 */
export function splitPipeline(command: string): string[] {
  const commands: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    // Handle escape in double quotes
    if (char === '\\' && inDoubleQuote && i + 1 < command.length) {
      current += char + command[i + 1]
      i++
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      // Check if it's not || (logical OR)
      const nextChar = i + 1 < command.length ? command[i + 1] : ''
      if (nextChar !== '|') {
        // This is a pipe, split here
        if (current.trim()) {
          commands.push(current.trim())
        }
        current = ''
      } else {
        // This is ||, include both characters
        current += '||'
        i++
      }
    } else {
      current += char
    }
  }

  if (current.trim()) {
    commands.push(current.trim())
  }

  return commands
}

/**
 * Normalize a command by removing extra whitespace.
 *
 * @param command - The command to normalize
 * @returns The normalized command
 */
export function normalizeCommand(command: string): string {
  // Preserve quotes while normalizing whitespace between tokens
  const tokens = tokenize(command.trim())
  return tokens.join(' ')
}
