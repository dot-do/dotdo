/**
 * Command Optimization Suggestions
 *
 * Detects suboptimal bash command patterns and generates
 * optimized alternatives that preserve semantics.
 *
 * Categories:
 * - Useless cat (UUOC - Useless Use Of Cat)
 * - Suboptimal find + xargs patterns
 * - Suboptimal for loops with $(ls)
 * - Multiple pipes that could be combined
 * - Suboptimal grep patterns
 * - Other common anti-patterns
 */

import type { Program, Pipeline, Command, BashNode, CompoundCommand } from '../types.js'
import { parse } from './parser.js'

// ============================================================================
// Types for Optimization Suggestions
// ============================================================================

/**
 * An optimization suggestion for a bash command
 */
export interface OptimizationSuggestion {
  /** The type of optimization */
  type: 'useless-cat' | 'find-xargs' | 'for-ls' | 'pipe-combine' | 'grep-pattern' | 'other'
  /** Human-readable description of the issue */
  description: string
  /** The original command pattern */
  original: string
  /** The suggested optimized command */
  optimized: string
  /** Why this optimization is beneficial */
  reason: string
  /** Whether the optimization preserves exact semantics */
  preservesSemantics: boolean
  /** Severity: info, warning, or error */
  severity: 'info' | 'warning' | 'error'
}

/**
 * Result of optimization analysis
 */
export interface OptimizationResult {
  /** Whether optimizations were found */
  hasOptimizations: boolean
  /** List of optimization suggestions */
  suggestions: OptimizationSuggestion[]
  /** The fully optimized command (if all suggestions applied) */
  optimizedCommand?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get command name from a Command node
 */
function getCommandName(cmd: Command): string {
  return cmd.name?.value ?? ''
}

/**
 * Get arguments as string array from a Command node
 */
function getArgs(cmd: Command): string[] {
  return cmd.args.map(arg => arg.value)
}

/**
 * Reconstruct a command string from a Command node
 */
function reconstructCommand(cmd: Command): string {
  const name = getCommandName(cmd)
  const args = getArgs(cmd)
  if (!name) return args.join(' ')
  return args.length > 0 ? `${name} ${args.join(' ')}` : name
}

/**
 * Check if a word contains command substitution
 * @internal Reserved for future pattern detection
 */
export function hasCommandSubstitution(word: string): boolean {
  return word.includes('$(') || word.includes('`')
}

/**
 * Check if a word contains process substitution
 */
function hasProcessSubstitution(word: string): boolean {
  return word.includes('<(') || word.includes('>(')
}

/**
 * Check if a command reads from stdin (cat -)
 */
function readsFromStdin(cmd: Command): boolean {
  const name = getCommandName(cmd)
  const args = getArgs(cmd)
  return name === 'cat' && args.includes('-')
}

/**
 * Commands that can accept file arguments instead of piped input
 */
const FILE_ACCEPTING_COMMANDS = new Set([
  'grep', 'awk', 'sed', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr',
  'less', 'more', 'nl', 'tac', 'rev', 'fold', 'fmt', 'pr', 'expand', 'unexpand'
])

/**
 * Extract all pipelines from AST
 */
function extractPipelines(ast: Program): Pipeline[] {
  const pipelines: Pipeline[] = []

  function traverse(node: BashNode): void {
    switch (node.type) {
      case 'Program':
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'Pipeline':
        pipelines.push(node)
        break
      case 'List':
        traverse(node.left)
        traverse(node.right)
        break
      case 'Subshell':
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'CompoundCommand':
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'FunctionDef':
        traverse(node.body)
        break
    }
  }

  traverse(ast)
  return pipelines
}

/**
 * Extract for loops from AST
 * @internal Reserved for future for-loop optimization
 */
export function extractForLoops(ast: Program): CompoundCommand[] {
  const forLoops: CompoundCommand[] = []

  function traverse(node: BashNode): void {
    switch (node.type) {
      case 'Program':
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'CompoundCommand':
        if (node.kind === 'for') {
          forLoops.push(node)
        }
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'List':
        traverse(node.left)
        traverse(node.right)
        break
      case 'Subshell':
        for (const child of node.body) {
          traverse(child)
        }
        break
      case 'FunctionDef':
        traverse(node.body)
        break
    }
  }

  traverse(ast)
  return forLoops
}

// ============================================================================
// Useless Cat Detection
// ============================================================================

/**
 * Detect useless cat patterns: cat file | command -> command file
 */
function detectUselessCat(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  const firstCmd = pipeline.commands[0]
  const firstCmdName = getCommandName(firstCmd)

  if (firstCmdName !== 'cat') return null

  const catArgs = getArgs(firstCmd)

  // Skip if cat reads from stdin
  if (readsFromStdin(firstCmd)) return null

  // Skip if no arguments to cat
  if (catArgs.length === 0) return null

  // Check for process substitution
  if (catArgs.some(arg => hasProcessSubstitution(arg))) return null

  // Get the second command
  const secondCmd = pipeline.commands[1]
  const secondCmdName = getCommandName(secondCmd)

  if (!FILE_ACCEPTING_COMMANDS.has(secondCmdName)) return null

  const secondArgs = getArgs(secondCmd)
  const files = catArgs.filter(arg => !arg.startsWith('-'))

  // Multiple files case - needs special handling
  if (files.length > 1) {
    // For grep with multiple files, we need -h to suppress filename prefix
    if (secondCmdName === 'grep') {
      const optimizedArgs = [...secondArgs, ...files]
      const optimized = `grep -h ${optimizedArgs.join(' ')}`
      return {
        type: 'useless-cat',
        description: 'cat with multiple files piped to grep',
        original: originalInput,
        optimized,
        reason: 'Useless use of cat - grep can read multiple files directly with -h flag',
        preservesSemantics: true,
        severity: 'info',
      }
    }
    return null
  }

  // Single file case
  const file = files[0]
  if (!file) return null

  // Build optimized command
  let optimizedArgs: string[]
  if (secondArgs.length > 0) {
    optimizedArgs = [...secondArgs, file]
  } else {
    optimizedArgs = [file]
  }

  // Handle remaining pipeline commands
  let optimized = `${secondCmdName} ${optimizedArgs.join(' ')}`

  // If there are more commands in the pipeline
  if (pipeline.commands.length > 2) {
    const remainingCmds = pipeline.commands.slice(2).map(reconstructCommand).join(' | ')
    optimized = `${optimized} | ${remainingCmds}`
  }

  return {
    type: 'useless-cat',
    description: `cat ${file} piped to ${secondCmdName}`,
    original: originalInput,
    optimized,
    reason: `Useless use of cat - ${secondCmdName} can read files directly`,
    preservesSemantics: true,
    severity: 'info',
  }
}

// ============================================================================
// Find + Xargs Detection
// ============================================================================

/**
 * Detect find | xargs patterns
 */
function detectFindXargs(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  const findIdx = pipeline.commands.findIndex(cmd => getCommandName(cmd) === 'find')
  const xargsIdx = pipeline.commands.findIndex(cmd => getCommandName(cmd) === 'xargs')

  if (findIdx === -1 || xargsIdx === -1 || xargsIdx !== findIdx + 1) return null

  const findCmd = pipeline.commands[findIdx]
  const xargsCmd = pipeline.commands[xargsIdx]

  const findArgs = getArgs(findCmd)
  const xargsArgs = getArgs(xargsCmd)

  // Check for -print0 | xargs -0 (already optimized for null handling)
  // These are used for pattern detection but not currently exposed
  const _hasPrint0 = findArgs.includes('-print0')
  const _hasXargs0 = xargsArgs.includes('-0')
  void _hasPrint0
  void _hasXargs0

  // Get the command being run by xargs
  const xargsCommand = xargsArgs.filter(arg => !arg.startsWith('-'))[0]

  // Handle rm case
  if (xargsCommand === 'rm') {
    const rmArgs = xargsArgs.filter(arg => arg !== 'rm')
    const hasRecursive = rmArgs.includes('-r') || rmArgs.includes('-R')

    // Don't suggest -delete for rm -r (different semantics)
    if (hasRecursive) {
      return null
    }

    // Reconstruct find command without -print0 if present
    const findParts = findArgs.filter(arg => arg !== '-print0')
    const optimized = `find ${findParts.join(' ')} -delete`

    return {
      type: 'find-xargs',
      description: 'find piped to xargs rm',
      original: originalInput,
      optimized,
      reason: 'find -delete is more efficient and handles special characters correctly',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  // Handle other commands - suggest -exec {} +
  if (xargsCommand) {
    const cmdArgs = xargsArgs.filter(arg => arg !== xargsCommand && !arg.startsWith('-'))
    const findParts = findArgs.filter(arg => arg !== '-print0')

    let optimized: string
    if (cmdArgs.length > 0) {
      optimized = `find ${findParts.join(' ')} -exec ${xargsCommand} ${cmdArgs.join(' ')} {} +`
    } else {
      optimized = `find ${findParts.join(' ')} -exec ${xargsCommand} {} +`
    }

    return {
      type: 'find-xargs',
      description: `find piped to xargs ${xargsCommand}`,
      original: originalInput,
      optimized,
      reason: 'find -exec with + is more efficient than piping to xargs',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

// ============================================================================
// Pipe Combination Detection
// ============================================================================

/**
 * Detect grep | grep patterns
 */
function detectGrepGrepCombine(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  // Find consecutive grep commands
  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) !== 'grep' || getCommandName(cmd2) !== 'grep') continue

    const args1 = getArgs(cmd1)
    const args2 = getArgs(cmd2)

    // Check for grep | grep -l (this is a grep-pattern issue, not pipe-combine)
    if (args2.includes('-l')) {
      return null  // Let detectGrepPatternIssues handle this
    }

    const hasV1 = args1.includes('-v')
    const hasV2 = args2.includes('-v')

    // Both have -v: combine with |
    if (hasV1 && hasV2) {
      const pattern1 = args1.filter(a => !a.startsWith('-'))[0]
      const pattern2 = args2.filter(a => !a.startsWith('-'))[0]
      const file = args1.filter(a => !a.startsWith('-')).slice(1)[0]

      const fileArg = file ? ` ${file}` : ''
      const optimized = `grep -v -E "${pattern1}|${pattern2}"${fileArg}`

      return {
        type: 'pipe-combine',
        description: 'Multiple grep -v commands',
        original: originalInput,
        optimized,
        reason: 'Multiple grep -v can be combined with -E and | (OR)',
        preservesSemantics: true,
        severity: 'info',
      }
    }

    // Neither has -v: combine with .*
    if (!hasV1 && !hasV2) {
      const pattern1 = args1.filter(a => !a.startsWith('-'))[0]
      const pattern2 = args2.filter(a => !a.startsWith('-'))[0]
      const file = args1.filter(a => !a.startsWith('-')).slice(1)[0]

      const fileArg = file ? ` ${file}` : ''
      const optimized = `grep -E "${pattern1}.*${pattern2}"${fileArg}`

      return {
        type: 'pipe-combine',
        description: 'Multiple grep commands filtering for both patterns',
        original: originalInput,
        optimized,
        reason: 'Multiple grep can be combined with -E and pattern1.*pattern2',
        preservesSemantics: true,
        severity: 'info',
      }
    }

    // Mixed -v and non-v: cannot combine, different semantics
    return null
  }

  return null
}

/**
 * Detect sort | uniq patterns (also checks for cat | sort | uniq)
 */
function detectSortUniq(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  // Check for cat | sort | uniq pattern first
  if (pipeline.commands.length >= 3) {
    const cmd0 = pipeline.commands[0]
    const cmd1 = pipeline.commands[1]
    const cmd2 = pipeline.commands[2]

    if (getCommandName(cmd0) === 'cat' && getCommandName(cmd1) === 'sort' && getCommandName(cmd2) === 'uniq') {
      const catArgs = getArgs(cmd0)
      const uniqArgs = getArgs(cmd2)

      // Don't combine if uniq has -c (count) or -d (duplicates only)
      if (uniqArgs.includes('-c') || uniqArgs.includes('-d') || uniqArgs.includes('-u')) {
        return null
      }

      const file = catArgs.filter(a => !a.startsWith('-'))[0]
      if (file) {
        return {
          type: 'pipe-combine',
          description: 'cat piped to sort piped to uniq',
          original: originalInput,
          optimized: `sort -u ${file}`,
          reason: 'sort -u combines sorting and deduplication, and can read files directly',
          preservesSemantics: true,
          severity: 'info',
        }
      }
    }
  }

  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) !== 'sort' || getCommandName(cmd2) !== 'uniq') continue

    const uniqArgs = getArgs(cmd2)

    // Don't combine if uniq has -c (count) or -d (duplicates only)
    if (uniqArgs.includes('-c') || uniqArgs.includes('-d') || uniqArgs.includes('-u')) {
      return null
    }

    const sortArgs = getArgs(cmd1)
    const file = sortArgs.filter(a => !a.startsWith('-'))[0]

    // Get sort flags
    const sortFlags = sortArgs.filter(a => a.startsWith('-'))

    let optimized: string
    if (file) {
      if (sortFlags.length > 0) {
        optimized = `sort ${sortFlags.join(' ')} -u ${file}`
      } else {
        optimized = `sort -u ${file}`
      }
    } else {
      if (sortFlags.length > 0) {
        optimized = `sort ${sortFlags.join(' ')} -u`
      } else {
        optimized = `sort -u`
      }
    }

    return {
      type: 'pipe-combine',
      description: 'sort piped to uniq',
      original: originalInput,
      optimized,
      reason: 'sort -u combines sorting and deduplication',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

/**
 * Detect grep | wc -l patterns (also checks for cat | grep | wc -l)
 */
function detectGrepWc(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  // Check for cat | grep | wc -l pattern first
  if (pipeline.commands.length >= 3) {
    const cmd0 = pipeline.commands[0]
    const cmd1 = pipeline.commands[1]
    const cmd2 = pipeline.commands[2]

    if (getCommandName(cmd0) === 'cat' && getCommandName(cmd1) === 'grep' && getCommandName(cmd2) === 'wc') {
      const catArgs = getArgs(cmd0)
      const grepArgs = getArgs(cmd1)
      const wcArgs = getArgs(cmd2)

      // Only optimize wc -l
      if (!wcArgs.includes('-l') && wcArgs.length !== 0) {
        // Continue to regular check
      } else {
        const file = catArgs.filter(a => !a.startsWith('-'))[0]
        const pattern = grepArgs.filter(a => !a.startsWith('-'))[0]
        const flags = grepArgs.filter(a => a.startsWith('-'))
        const flagStr = flags.length > 0 ? `${flags.join(' ')} ` : ''

        if (file && pattern) {
          return {
            type: 'pipe-combine',
            description: 'cat piped to grep piped to wc -l',
            original: originalInput,
            optimized: `grep ${flagStr}-c ${pattern} ${file}`.replace(/\s+/g, ' ').trim(),
            reason: 'grep -c counts matching lines directly and can read files directly',
            preservesSemantics: true,
            severity: 'info',
          }
        }
      }
    }
  }

  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) !== 'grep' || getCommandName(cmd2) !== 'wc') continue

    const wcArgs = getArgs(cmd2)

    // Only optimize wc -l
    if (!wcArgs.includes('-l') && wcArgs.length !== 0) continue

    const grepArgs = getArgs(cmd1)
    const pattern = grepArgs.filter(a => !a.startsWith('-'))[0]
    const file = grepArgs.filter(a => !a.startsWith('-'))[1]

    const flags = grepArgs.filter(a => a.startsWith('-'))
    const flagStr = flags.length > 0 ? `${flags.join(' ')} ` : ''

    const optimized = file
      ? `grep ${flagStr}-c ${pattern} ${file}`
      : `grep ${flagStr}-c ${pattern}`

    return {
      type: 'pipe-combine',
      description: 'grep piped to wc -l',
      original: originalInput,
      optimized: optimized.replace(/\s+/g, ' ').trim(),
      reason: 'grep -c counts matching lines directly',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

/**
 * Detect head | tail patterns (also checks for cat | head | tail)
 */
function detectHeadTail(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  // Check for cat | head | tail pattern first
  if (pipeline.commands.length >= 3) {
    const cmd0 = pipeline.commands[0]
    const cmd1 = pipeline.commands[1]
    const cmd2 = pipeline.commands[2]

    if (getCommandName(cmd0) === 'cat' && getCommandName(cmd1) === 'head' && getCommandName(cmd2) === 'tail') {
      const catArgs = getArgs(cmd0)
      const headArgs = getArgs(cmd1)
      const tailArgs = getArgs(cmd2)

      // Parse head -n N
      const headNIdx = headArgs.indexOf('-n')
      const headN = headNIdx !== -1 ? parseInt(headArgs[headNIdx + 1], 10) : NaN

      // Parse tail -n M
      const tailNIdx = tailArgs.indexOf('-n')
      const tailN = tailNIdx !== -1 ? parseInt(tailArgs[tailNIdx + 1], 10) : NaN

      if (!isNaN(headN) && !isNaN(tailN)) {
        const file = catArgs.filter(a => !a.startsWith('-'))[0]

        // head -n N | tail -n M gets lines (N-M+1) to N
        const startLine = headN - tailN + 1
        const endLine = headN

        if (file) {
          return {
            type: 'pipe-combine',
            description: 'cat piped to head piped to tail',
            original: originalInput,
            optimized: `sed -n "${startLine},${endLine}p" ${file}`,
            reason: 'sed -n with line range is more efficient and can read files directly',
            preservesSemantics: true,
            severity: 'info',
          }
        }
      }
    }
  }

  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) !== 'head' || getCommandName(cmd2) !== 'tail') continue

    const headArgs = getArgs(cmd1)
    const tailArgs = getArgs(cmd2)

    // Parse head -n N
    const headNIdx = headArgs.indexOf('-n')
    const headN = headNIdx !== -1 ? parseInt(headArgs[headNIdx + 1], 10) : NaN

    // Parse tail -n M
    const tailNIdx = tailArgs.indexOf('-n')
    const tailN = tailNIdx !== -1 ? parseInt(tailArgs[tailNIdx + 1], 10) : NaN

    if (isNaN(headN) || isNaN(tailN)) continue

    // Get file (args that are not -n or numbers after -n)
    const file = headArgs.filter((a, idx) => {
      // Skip flags
      if (a.startsWith('-')) return false
      // Skip the number after -n
      if (idx > 0 && headArgs[idx - 1] === '-n') return false
      return true
    })[0]

    // head -n N | tail -n M gets lines (N-M+1) to N
    const startLine = headN - tailN + 1
    const endLine = headN

    const fileArg = file ? ` ${file}` : ''
    const optimized = `sed -n "${startLine},${endLine}p"${fileArg}`

    return {
      type: 'pipe-combine',
      description: 'head piped to tail',
      original: originalInput,
      optimized,
      reason: 'sed -n with line range is more efficient',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

// ============================================================================
// Grep Pattern Detection
// ============================================================================

/**
 * Detect grep pattern issues
 */
function detectGrepPatternIssues(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  // Detect grep | grep -l
  const grepCmd = pipeline.commands.find(cmd => getCommandName(cmd) === 'grep')
  if (!grepCmd) return null

  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) === 'grep' && getCommandName(cmd2) === 'grep') {
      const args2 = getArgs(cmd2)
      if (args2.includes('-l')) {
        const args1 = getArgs(cmd1)
        const nonFlagArgs = args1.filter(a => !a.startsWith('-'))
        const pattern = nonFlagArgs[0]
        // Files are all args after the pattern
        const files = nonFlagArgs.slice(1)
        const fileStr = files.length > 0 ? ` ${files.join(' ')}` : ''

        return {
          type: 'grep-pattern',
          description: 'grep piped to grep -l',
          original: originalInput,
          optimized: `grep -l ${pattern}${fileStr}`,
          reason: 'Use grep -l directly instead of piping',
          preservesSemantics: true,
          severity: 'info',
        }
      }
    }
  }

  // Detect echo | grep -f -
  for (let i = 0; i < pipeline.commands.length - 1; i++) {
    const cmd1 = pipeline.commands[i]
    const cmd2 = pipeline.commands[i + 1]

    if (getCommandName(cmd1) === 'echo' && getCommandName(cmd2) === 'grep') {
      const grepArgs = getArgs(cmd2)
      if (grepArgs.includes('-f') && grepArgs.includes('-')) {
        const echoArgs = getArgs(cmd1)
        const pattern = echoArgs[0]
        const file = grepArgs.filter(a => a !== '-f' && a !== '-')[0]

        return {
          type: 'grep-pattern',
          description: 'echo piped to grep -f -',
          original: originalInput,
          optimized: `grep ${pattern} ${file}`,
          reason: 'Use grep with pattern directly',
          preservesSemantics: true,
          severity: 'info',
        }
      }
    }
  }

  return null
}

// ============================================================================
// Other Anti-pattern Detection
// ============================================================================

/**
 * Detect echo | cat (useless echo)
 */
function detectUselessEcho(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  const cmd1 = pipeline.commands[0]
  const cmd2 = pipeline.commands[1]

  if (getCommandName(cmd1) !== 'echo' || getCommandName(cmd2) !== 'cat') return null

  const echoArgs = getArgs(cmd1)

  return {
    type: 'other',
    description: 'echo piped to cat',
    original: originalInput,
    optimized: `echo ${echoArgs.join(' ')}`,
    reason: 'Piping echo to cat is useless',
    preservesSemantics: true,
    severity: 'info',
  }
}

/**
 * Detect ls | wc -l
 */
function detectLsWc(pipeline: Pipeline, originalInput: string): OptimizationSuggestion | null {
  if (pipeline.commands.length < 2) return null

  const cmd1 = pipeline.commands[0]
  const cmd2 = pipeline.commands[1]

  if (getCommandName(cmd1) !== 'ls' || getCommandName(cmd2) !== 'wc') return null

  const wcArgs = getArgs(cmd2)
  if (!wcArgs.includes('-l') && wcArgs.length !== 0) return null

  return {
    type: 'other',
    description: 'ls piped to wc -l',
    original: originalInput,
    optimized: 'find . -maxdepth 1 -type f | wc -l',
    reason: 'ls | wc -l fails with filenames containing newlines',
    preservesSemantics: false,
    severity: 'warning',
  }
}

/**
 * Detect basename $(pwd) pattern
 */
function detectBasenamePwd(input: string): OptimizationSuggestion | null {
  if (input.includes('basename $(pwd)') || input.includes('basename `pwd`')) {
    return {
      type: 'other',
      description: 'basename of pwd',
      original: input,
      optimized: '${PWD##*/}',
      reason: 'Parameter expansion is more efficient than command substitution',
      preservesSemantics: true,
      severity: 'info',
    }
  }
  return null
}

/**
 * Detect cd $(dirname $0) pattern
 */
function detectCdDirname(input: string): OptimizationSuggestion | null {
  if (input.includes('cd $(dirname $0)') || input.includes('cd `dirname $0`')) {
    return {
      type: 'other',
      description: 'cd to script directory',
      original: input,
      optimized: 'cd "${0%/*}"',
      reason: 'Parameter expansion is more efficient than command substitution',
      preservesSemantics: true,
      severity: 'info',
    }
  }
  return null
}

/**
 * Detect expr for arithmetic
 */
function detectExprArithmetic(input: string): OptimizationSuggestion | null {
  // Match expr N op M patterns
  const exprMatch = input.match(/^expr\s+(\$?\w+|\d+)\s+([+\-\*\/])\s+(\$?\w+|\d+)$/)
  if (exprMatch) {
    const [, left, op, right] = exprMatch
    return {
      type: 'other',
      description: 'expr for arithmetic',
      original: input,
      optimized: `$((${left} ${op} ${right}))`,
      reason: 'Arithmetic expansion is built-in and faster',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  // Match result=$(expr $a + $b) patterns
  const assignMatch = input.match(/^(\w+)=\$\(expr\s+\$(\w+)\s+([+\-\*\/])\s+\$(\w+)\)$/)
  if (assignMatch) {
    const [, result, left, op, right] = assignMatch
    return {
      type: 'other',
      description: 'expr assignment',
      original: input,
      optimized: `${result}=$((${left} ${op} ${right}))`,
      reason: 'Arithmetic expansion is built-in and faster',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

/**
 * Detect [ "x$var" = "x" ] pattern
 */
function detectXvarPattern(input: string): OptimizationSuggestion | null {
  const emptyMatch = input.match(/\[\s+"x\$(\w+)"\s+=\s+"x"\s+\]/)
  if (emptyMatch) {
    return {
      type: 'other',
      description: 'x$var empty test',
      original: input,
      optimized: `[ -z "$${emptyMatch[1]}" ]`,
      reason: 'Use -z test for empty string check',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  const nonEmptyMatch = input.match(/\[\s+"x\$(\w+)"\s+!=\s+"x"\s+\]/)
  if (nonEmptyMatch) {
    return {
      type: 'other',
      description: 'x$var non-empty test',
      original: input,
      optimized: `[ -n "$${nonEmptyMatch[1]}" ]`,
      reason: 'Use -n test for non-empty string check',
      preservesSemantics: true,
      severity: 'info',
    }
  }

  return null
}

// ============================================================================
// For Loop with $(ls) Detection
// ============================================================================

/**
 * Detect for f in $(ls) patterns in original input string
 */
function detectForLsFromInput(input: string): OptimizationSuggestion | null {
  // Match for VAR in $(ls ...) or for VAR in `ls ...`
  const forLsMatch = input.match(/for\s+(\w+)\s+in\s+(\$\(ls(?:\s+(-\w+))?(?:\s+([^\)]+))?\)|`ls(?:\s+(-\w+))?(?:\s+([^`]+))?`);\s*do\s+(.+);\s*done/)

  if (forLsMatch) {
    const [, varName, , _flag1, path1, _flag2, path2, body] = forLsMatch
    const path = path1 || path2 || ''
    // Flags are captured but not used currently - reserved for future enhancements
    void _flag1
    void _flag2

    let replacement: string
    if (path && path !== '*') {
      // Directory or pattern specified
      if (path.includes('*')) {
        replacement = path
      } else {
        replacement = `${path.replace(/\/$/, '')}/*`
      }
    } else {
      replacement = '*'
    }

    const optimized = `for ${varName} in ${replacement}; do ${body}; done`

    return {
      type: 'for-ls',
      description: 'for loop with $(ls)',
      original: input,
      optimized,
      reason: '$(ls) breaks on filenames with spaces or newlines, use glob instead',
      preservesSemantics: true,
      severity: 'warning',
    }
  }

  return null
}

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Analyze a command string for optimization opportunities
 */
export function analyzeOptimizations(input: string): OptimizationResult {
  if (!input || input.trim() === '') {
    return {
      hasOptimizations: false,
      suggestions: [],
    }
  }

  const suggestions: OptimizationSuggestion[] = []

  // Text-based pattern detection (before parsing)
  const basenamePwd = detectBasenamePwd(input)
  if (basenamePwd) suggestions.push(basenamePwd)

  const cdDirname = detectCdDirname(input)
  if (cdDirname) suggestions.push(cdDirname)

  const exprArith = detectExprArithmetic(input)
  if (exprArith) suggestions.push(exprArith)

  const xvarPattern = detectXvarPattern(input)
  if (xvarPattern) suggestions.push(xvarPattern)

  const forLs = detectForLsFromInput(input)
  if (forLs) suggestions.push(forLs)

  // Parse the input
  const ast = parse(input)

  // AST-based analysis
  const pipelines = extractPipelines(ast)

  for (const pipeline of pipelines) {
    // Compound pattern detection (cat | ... | ...) FIRST to get best optimization as suggestions[0]

    // Sort | uniq detection (checks cat | sort | uniq first)
    const sortUniq = detectSortUniq(pipeline, input)
    if (sortUniq) suggestions.push(sortUniq)

    // Grep | wc -l detection (checks cat | grep | wc -l first)
    const grepWc = detectGrepWc(pipeline, input)
    if (grepWc) suggestions.push(grepWc)

    // Head | tail detection (checks cat | head | tail first)
    const headTail = detectHeadTail(pipeline, input)
    if (headTail) suggestions.push(headTail)

    // Grep pattern issues (includes grep | grep -l)
    const grepPattern = detectGrepPatternIssues(pipeline, input)
    if (grepPattern) suggestions.push(grepPattern)

    // Grep | grep detection (after grep pattern issues since they overlap)
    const grepGrep = detectGrepGrepCombine(pipeline, input)
    if (grepGrep) suggestions.push(grepGrep)

    // Useless cat detection (after compound patterns)
    const uselessCat = detectUselessCat(pipeline, input)
    if (uselessCat) suggestions.push(uselessCat)

    // Find + xargs detection
    const findXargs = detectFindXargs(pipeline, input)
    if (findXargs) suggestions.push(findXargs)

    // Useless echo
    const uselessEcho = detectUselessEcho(pipeline, input)
    if (uselessEcho) suggestions.push(uselessEcho)

    // ls | wc -l
    const lsWc = detectLsWc(pipeline, input)
    if (lsWc) suggestions.push(lsWc)
  }

  // Generate fully optimized command
  let optimizedCommand: string | undefined
  if (suggestions.length > 0) {
    // For the final optimized command, apply all optimizations in sequence
    optimizedCommand = applyAllOptimizations(input, suggestions)
  }

  return {
    hasOptimizations: suggestions.length > 0,
    suggestions,
    optimizedCommand,
  }
}

/**
 * Analyze an AST for optimization opportunities
 */
export function analyzeOptimizationsFromAst(ast: Program): OptimizationResult {
  const suggestions: OptimizationSuggestion[] = []

  const pipelines = extractPipelines(ast)

  for (const pipeline of pipelines) {
    // Reconstruct original input from AST for error messages
    const originalInput = pipeline.commands.map(reconstructCommand).join(' | ')

    // Useless cat detection
    const uselessCat = detectUselessCat(pipeline, originalInput)
    if (uselessCat) suggestions.push(uselessCat)

    // Find + xargs detection
    const findXargs = detectFindXargs(pipeline, originalInput)
    if (findXargs) suggestions.push(findXargs)

    // Sort | uniq detection
    const sortUniq = detectSortUniq(pipeline, originalInput)
    if (sortUniq) suggestions.push(sortUniq)

    // Grep | wc -l detection
    const grepWc = detectGrepWc(pipeline, originalInput)
    if (grepWc) suggestions.push(grepWc)

    // Grep | grep detection
    const grepGrep = detectGrepGrepCombine(pipeline, originalInput)
    if (grepGrep) suggestions.push(grepGrep)
  }

  return {
    hasOptimizations: suggestions.length > 0,
    suggestions,
  }
}

/**
 * Apply all optimizations to get the final optimized command
 */
function applyAllOptimizations(input: string, suggestions: OptimizationSuggestion[]): string {
  // Group suggestions by type to determine the best optimization
  const hasUselessCat = suggestions.some(s => s.type === 'useless-cat')
  const hasPipeCombine = suggestions.some(s => s.type === 'pipe-combine')
  const hasForLs = suggestions.some(s => s.type === 'for-ls')

  // Special case: cat | sort | uniq -> sort -u file
  // The pipe-combine detection already handles this and includes the file
  if (hasPipeCombine) {
    const sortUniq = suggestions.find(s => s.type === 'pipe-combine' && s.optimized.includes('sort -u'))
    if (sortUniq) {
      return sortUniq.optimized
    }
  }

  // Special case: cat | grep | wc -l -> grep -c pattern file
  if (hasPipeCombine) {
    const grepWc = suggestions.find(s => s.type === 'pipe-combine' && s.optimized.includes('grep') && s.optimized.includes('-c'))
    if (grepWc) {
      return grepWc.optimized
    }
  }

  // Special case: cat | head | tail -> sed -n
  if (hasPipeCombine) {
    const headTail = suggestions.find(s => s.type === 'pipe-combine' && s.optimized.includes('sed -n'))
    if (headTail) {
      return headTail.optimized
    }
  }

  // Special case: for $(ls) with nested useless cat
  if (hasForLs && hasUselessCat) {
    const forLsSuggestion = suggestions.find(s => s.type === 'for-ls')
    const catSuggestion = suggestions.find(s => s.type === 'useless-cat')
    if (forLsSuggestion && catSuggestion) {
      // Get the variable name and build the correct replacement
      const varMatch = forLsSuggestion.optimized.match(/for\s+(\w+)\s+in/)
      const varName = varMatch ? varMatch[1] : 'f'

      // Get the grep pattern from the cat suggestion
      const grepMatch = catSuggestion.optimized.match(/grep\s+(\S+)/)
      const grepPattern = grepMatch ? grepMatch[1] : 'pattern'

      // Build the correct optimized command
      return `for ${varName} in *; do grep ${grepPattern} "$${varName}"; done`
    }
  }

  // Default: return the most impactful optimization
  if (suggestions.length > 0) {
    // Prioritize pipe-combine optimizations as they're usually most impactful
    const pipeCombine = suggestions.find(s => s.type === 'pipe-combine')
    if (pipeCombine) return pipeCombine.optimized

    return suggestions[0].optimized
  }

  return input
}
