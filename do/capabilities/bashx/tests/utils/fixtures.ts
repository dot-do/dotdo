/**
 * Sample AST Fixtures for Testing
 *
 * Pre-built AST structures for common bash patterns.
 */

import type {
  Program,
  Command,
  Pipeline,
  List,
  Word,
  Redirect,
  Assignment,
} from '../../src/types.js'

// ============================================================================
// Word Helpers
// ============================================================================

export function word(value: string, quoted?: 'single' | 'double'): Word {
  return { type: 'Word', value, quoted }
}

// ============================================================================
// Simple Command Fixtures
// ============================================================================

export function simpleCommand(
  name: string,
  args: string[] = [],
  redirects: Redirect[] = [],
  prefix: Assignment[] = []
): Command {
  return {
    type: 'Command',
    name: word(name),
    args: args.map((a) => word(a)),
    redirects,
    prefix,
  }
}

export function program(...body: (Command | Pipeline | List)[]): Program {
  return {
    type: 'Program',
    body,
  }
}

// ============================================================================
// Common Command Patterns
// ============================================================================

/**
 * Simple ls command: ls -la
 */
export const LS_COMMAND: Program = program(simpleCommand('ls', ['-la']))

/**
 * Git status: git status
 */
export const GIT_STATUS: Program = program(simpleCommand('git', ['status']))

/**
 * Cat a file: cat package.json
 */
export const CAT_FILE: Program = program(simpleCommand('cat', ['package.json']))

/**
 * Echo with string: echo "hello world"
 */
export const ECHO_HELLO: Program = program(
  simpleCommand('echo', ['hello world'])
)

/**
 * Find command: find . -name "*.ts"
 */
export const FIND_TS_FILES: Program = program(
  simpleCommand('find', ['.', '-name', '*.ts'])
)

// ============================================================================
// Pipeline Fixtures
// ============================================================================

/**
 * Pipeline: ls | grep foo
 */
export const LS_GREP_PIPELINE: Program = program({
  type: 'Pipeline',
  negated: false,
  commands: [simpleCommand('ls'), simpleCommand('grep', ['foo'])],
})

/**
 * Complex pipeline: cat file.txt | grep pattern | wc -l
 */
export const CAT_GREP_WC_PIPELINE: Program = program({
  type: 'Pipeline',
  negated: false,
  commands: [
    simpleCommand('cat', ['file.txt']),
    simpleCommand('grep', ['pattern']),
    simpleCommand('wc', ['-l']),
  ],
})

// ============================================================================
// Redirect Fixtures
// ============================================================================

export function redirect(
  op: '>' | '>>' | '<' | '<<' | '<<<' | '>&' | '<&' | '<>' | '>|',
  target: string,
  fd?: number
): Redirect {
  return { type: 'Redirect', op, target: word(target), fd }
}

/**
 * Command with output redirect: echo "hello" > output.txt
 */
export const ECHO_REDIRECT: Program = program({
  ...simpleCommand('echo', ['hello']),
  redirects: [redirect('>', 'output.txt')],
})

/**
 * Command with append redirect: echo "more" >> log.txt
 */
export const ECHO_APPEND: Program = program({
  ...simpleCommand('echo', ['more']),
  redirects: [redirect('>>', 'log.txt')],
})

/**
 * Command with input redirect: wc -l < input.txt
 */
export const WC_INPUT: Program = program({
  ...simpleCommand('wc', ['-l']),
  redirects: [redirect('<', 'input.txt')],
})

// ============================================================================
// List/Conditional Fixtures
// ============================================================================

/**
 * AND list: mkdir foo && cd foo
 */
export const MKDIR_AND_CD: Program = program({
  type: 'List',
  operator: '&&',
  left: simpleCommand('mkdir', ['foo']),
  right: simpleCommand('cd', ['foo']),
})

/**
 * OR list: test -f file.txt || touch file.txt
 */
export const TEST_OR_TOUCH: Program = program({
  type: 'List',
  operator: '||',
  left: simpleCommand('test', ['-f', 'file.txt']),
  right: simpleCommand('touch', ['file.txt']),
})

/**
 * Semicolon list: echo start; sleep 1; echo done
 */
export const SEQUENTIAL_COMMANDS: Program = program({
  type: 'List',
  operator: ';',
  left: {
    type: 'List',
    operator: ';',
    left: simpleCommand('echo', ['start']),
    right: simpleCommand('sleep', ['1']),
  },
  right: simpleCommand('echo', ['done']),
})

// ============================================================================
// Assignment Fixtures
// ============================================================================

export function assignment(
  name: string,
  value: string | null,
  operator: '=' | '+=' = '='
): Assignment {
  return {
    type: 'Assignment',
    name,
    value: value ? word(value) : null,
    operator,
  }
}

/**
 * Environment variable command: FOO=bar echo $FOO
 */
export const ENV_VAR_COMMAND: Program = program({
  ...simpleCommand('echo', ['$FOO']),
  prefix: [assignment('FOO', 'bar')],
})

// ============================================================================
// Error Fixtures (for testing error handling)
// ============================================================================

/**
 * Program with parse errors
 */
export const PROGRAM_WITH_ERRORS: Program = {
  type: 'Program',
  body: [],
  errors: [
    {
      message: 'Unexpected end of input',
      line: 1,
      column: 10,
      suggestion: 'Check for unclosed quotes or brackets',
    },
  ],
}

/**
 * Empty program (valid but no commands)
 */
export const EMPTY_PROGRAM: Program = program()
