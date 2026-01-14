/**
 * Help text for CLI commands
 */

import { VERSION } from './version'

/**
 * Main help text shown with --help or no arguments
 */
export function mainHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx <command> [options]

Commands:
  ls [path]         list directory contents
  cat <files...>    read and concatenate file contents
  mkdir <paths...>  create directories
  rm <paths...>     remove files or directories
  cp <src> <dest>   copy files

For more info, run any command with the --help flag:
  $ fsx ls --help
  $ fsx cat --help
  $ fsx mkdir --help
  $ fsx rm --help
  $ fsx cp --help

Options:
  -v, --version  Display version number
  -h, --help     Display this message
`
}

/**
 * Help text for ls command
 */
export function lsHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx ls [path]

Options:
  -l, --long  Use long listing format
  -a, --all   Show hidden files (including . and ..)
  -h, --help  Display this message

Description:
  list directory contents
`
}

/**
 * Help text for cat command
 */
export function catHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx cat <files...>

Options:
  -h, --help  Display this message

Description:
  read and concatenate file contents
`
}

/**
 * Help text for mkdir command
 */
export function mkdirHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx mkdir <paths...>

Options:
  -p, --parents  Create parent directories as needed (recursive)
  -h, --help     Display this message

Description:
  create directories
`
}

/**
 * Help text for rm command
 */
export function rmHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx rm <paths...>

Options:
  -r, -R, --recursive  Remove directories and their contents recursively
  -f, --force          Ignore nonexistent files, never prompt
  -h, --help           Display this message

Description:
  remove files or directories
`
}

/**
 * Help text for cp command
 */
export function cpHelp(): string {
  return `fsx/${VERSION}

Usage:
  $ fsx cp <source> <dest>

Options:
  -r, -R, --recursive  Copy directories recursively
  -h, --help           Display this message

Description:
  copy files
`
}

/**
 * Get help text for a specific command
 */
export function getCommandHelp(command: string): string | null {
  switch (command) {
    case 'ls': return lsHelp()
    case 'cat': return catHelp()
    case 'mkdir': return mkdirHelp()
    case 'rm': return rmHelp()
    case 'cp': return cpHelp()
    default: return null
  }
}
