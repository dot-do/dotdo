/**
 * AST Traversal Utilities
 *
 * Visitor pattern and extraction utilities for bash AST.
 */

import type {
  Program,
  BashNode,
  Command,
  Redirect,
  Pipeline,
  List,
  Subshell,
  CompoundCommand,
} from '../types.js'

/**
 * Visitor callbacks for AST traversal.
 * Each callback receives the specific node type it's named for.
 */
export interface Visitor {
  Program?: (node: Program) => void
  Command?: (node: Command) => void
  Pipeline?: (node: Pipeline) => void
  List?: (node: List) => void
  Subshell?: (node: Subshell) => void
  CompoundCommand?: (node: CompoundCommand) => void
}

/**
 * Visit all nodes in an AST with callbacks.
 * Traverses the tree depth-first, calling visitor callbacks for each node type.
 */
export function visit(ast: Program, visitor: Visitor): void {
  // Call Program visitor for root
  visitor.Program?.(ast)

  // Visit all body nodes
  for (const node of ast.body) {
    visitNode(node, visitor)
  }
}

/**
 * Visit a single AST node and recursively visit its children.
 */
function visitNode(node: BashNode, visitor: Visitor): void {
  switch (node.type) {
    case 'Command':
      visitor.Command?.(node as Command)
      break

    case 'Pipeline': {
      const pipeline = node as Pipeline
      visitor.Pipeline?.(pipeline)
      // Visit all commands in the pipeline
      for (const cmd of pipeline.commands) {
        visitNode(cmd, visitor)
      }
      break
    }

    case 'List': {
      const list = node as List
      visitor.List?.(list)
      // Visit left and right sides
      visitNode(list.left, visitor)
      visitNode(list.right, visitor)
      break
    }

    case 'Subshell': {
      const subshell = node as Subshell
      visitor.Subshell?.(subshell)
      // Visit all body nodes
      for (const bodyNode of subshell.body) {
        visitNode(bodyNode, visitor)
      }
      break
    }

    case 'CompoundCommand': {
      const compound = node as CompoundCommand
      visitor.CompoundCommand?.(compound)
      // Visit all body nodes
      for (const bodyNode of compound.body) {
        visitNode(bodyNode, visitor)
      }
      break
    }

    case 'Program': {
      const prog = node as Program
      visitor.Program?.(prog)
      for (const bodyNode of prog.body) {
        visitNode(bodyNode, visitor)
      }
      break
    }

    // Other node types (Word, Assignment, Redirect, FunctionDef) are leaf-like
    // and don't need recursive traversal for the basic visitor pattern
    default:
      break
  }
}

/**
 * Extract all commands from an AST
 */
export function extractCommands(ast: Program): Command[] {
  const commands: Command[] = []

  visit(ast, {
    Command: (node) => {
      commands.push(node)
    },
  })

  return commands
}

/**
 * Commands that read files from their arguments
 */
const READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'awk',
  'sed',
  'sort',
  'uniq',
  'wc',
  'diff',
  'cmp',
  'file',
  'source',
  '.',
  'bat',
  'find',
])

/**
 * Commands that write to files from their arguments
 */
const WRITE_COMMANDS = new Set(['touch', 'tee'])

/**
 * Commands that read source and write to destination
 */
const COPY_COMMANDS = new Set(['cp', 'mv', 'rsync'])

/**
 * Special files to ignore
 */
const SPECIAL_FILES = new Set(['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '-'])

/**
 * Check if a string looks like a file path (not a flag or special value)
 */
function isFilePath(value: string): boolean {
  if (!value) return false
  // Skip flags
  if (value.startsWith('-') && value !== '-') return false
  // Skip special files
  if (SPECIAL_FILES.has(value)) return false
  return true
}

/**
 * Extract all file paths from an AST (from arguments and redirects).
 * Returns separate arrays for files that will be read vs written.
 */
export function extractFiles(ast: Program): { reads: string[]; writes: string[] } {
  const reads: string[] = []
  const writes: string[] = []

  const commands = extractCommands(ast)

  for (const cmd of commands) {
    const cmdName = cmd.name?.value

    // Handle redirects
    for (const redir of cmd.redirects) {
      const target = redir.target.value

      // Skip special files
      if (SPECIAL_FILES.has(target)) continue

      // Skip heredoc delimiters (they're not file paths)
      if (redir.op === '<<' || redir.op === '<<<') continue

      // Input redirects are reads
      if (redir.op === '<') {
        reads.push(target)
      }
      // Output redirects are writes
      else if (redir.op === '>' || redir.op === '>>' || redir.op === '>|' || redir.op === '<>') {
        writes.push(target)
      }
      // File descriptor redirects to files (not other descriptors)
      else if (redir.op === '>&' && !/^\d+$/.test(target) && !SPECIAL_FILES.has(target)) {
        writes.push(target)
      }
    }

    // Handle command-specific file arguments
    if (!cmdName) continue

    const args = cmd.args.map((a) => a.value)

    // Commands that read files
    if (READ_COMMANDS.has(cmdName)) {
      // grep -f patterns.txt data.txt - both are reads
      if (cmdName === 'grep') {
        let skipNext = false
        for (let i = 0; i < args.length; i++) {
          const arg = args[i]
          if (skipNext) {
            skipNext = false
            // -f argument is a file to read
            if (isFilePath(arg)) reads.push(arg)
            continue
          }
          if (arg === '-f' || arg === '--file') {
            skipNext = true
            continue
          }
          // Skip flags
          if (arg.startsWith('-')) continue
          // Everything else that looks like a file
          if (isFilePath(arg)) reads.push(arg)
        }
      }
      // find: first non-flag arg is the path
      else if (cmdName === 'find') {
        for (const arg of args) {
          if (arg.startsWith('-')) break
          if (isFilePath(arg)) {
            reads.push(arg)
            break
          }
        }
      }
      // Other read commands: all non-flag args are files
      else {
        for (const arg of args) {
          if (isFilePath(arg)) reads.push(arg)
        }
      }
    }

    // Commands that write files
    if (WRITE_COMMANDS.has(cmdName)) {
      // tee: all non-flag args are files to write
      if (cmdName === 'tee') {
        for (const arg of args) {
          if (isFilePath(arg)) writes.push(arg)
        }
      }
      // touch: all non-flag args are files to create/modify
      else if (cmdName === 'touch') {
        for (const arg of args) {
          if (isFilePath(arg)) writes.push(arg)
        }
      }
    }

    // Copy/move commands: source is read, dest is write
    if (COPY_COMMANDS.has(cmdName)) {
      const fileArgs = args.filter(isFilePath)
      if (fileArgs.length >= 2) {
        // All but last are sources (reads)
        for (let i = 0; i < fileArgs.length - 1; i++) {
          reads.push(fileArgs[i])
        }
        // Last is destination (write)
        writes.push(fileArgs[fileArgs.length - 1])
      }
    }
  }

  return { reads, writes }
}

/**
 * Extract all redirects from an AST
 */
export function extractRedirects(ast: Program): Redirect[] {
  const redirects: Redirect[] = []

  const commands = extractCommands(ast)

  for (const cmd of commands) {
    for (const redir of cmd.redirects) {
      redirects.push(redir)
    }
  }

  return redirects
}
