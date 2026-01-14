/**
 * Help text for CLI commands
 */

import { VERSION } from './version'

/**
 * Main help text shown with --help or no arguments
 */
export function mainHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx <command> [options]

Commands:
  install [packages...]  install packages
  i [packages...]        alias for install
  uninstall <packages...> remove packages
  rm <packages...>       alias for uninstall
  list                   list installed packages
  ls                     alias for list
  search <query>         search npm registry
  info <package>         show package info
  view <package>         alias for info
  run <script>           run package.json script
  exec <command>         execute a package binary
  init                   create package.json
  publish                publish package to registry
  version [bump]         bump package version

For more info, run any command with the --help flag:
  $ npmx install --help
  $ npmx search --help
  $ npmx run --help

Options:
  -v, --version  Display version number
  -h, --help     Display this message
`
}

/**
 * Help text for install command
 */
export function installHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx install [packages...]

Options:
  -S, --save          Save to dependencies (default)
  -D, --save-dev      Save to devDependencies
  -E, --save-exact    Save exact version
  -O, --save-optional Save to optionalDependencies
  -g, --global        Install globally
  --production        Skip devDependencies
  --registry=<url>    Use custom registry
  -h, --help          Display this message

Description:
  Install packages from npm registry. Without arguments, installs all
  dependencies from package.json.

Examples:
  $ npmx install                  # Install all dependencies
  $ npmx install lodash           # Install lodash
  $ npmx install -D vitest        # Install vitest as devDependency
  $ npmx i react@18               # Install specific version
`
}

/**
 * Help text for uninstall command
 */
export function uninstallHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx uninstall <packages...>

Options:
  -S, --save          Remove from dependencies
  -D, --save-dev      Remove from devDependencies
  -g, --global        Remove global package
  -h, --help          Display this message

Description:
  Remove installed packages.

Examples:
  $ npmx uninstall lodash
  $ npmx rm react react-dom
`
}

/**
 * Help text for list command
 */
export function listHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx list [package]

Options:
  --depth=<n>    Max depth (default: all)
  --json         Output as JSON
  -l, --long     Show extended info
  -g, --global   List global packages
  -h, --help     Display this message

Description:
  List installed packages.

Examples:
  $ npmx list              # All packages
  $ npmx ls --depth=0      # Top-level only
  $ npmx ls lodash         # Show lodash tree
`
}

/**
 * Help text for search command
 */
export function searchHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx search <query>

Options:
  --json             Output as JSON
  --registry=<url>   Use custom registry
  -h, --help         Display this message

Description:
  Search npm registry for packages.

Examples:
  $ npmx search react
  $ npmx search "state management"
`
}

/**
 * Help text for info command
 */
export function infoHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx info <package>[@version]

Options:
  --json             Output as JSON
  --registry=<url>   Use custom registry
  -h, --help         Display this message

Description:
  Show package information from the registry.

Examples:
  $ npmx info lodash
  $ npmx info react@18.2.0
  $ npmx view typescript versions
`
}

/**
 * Help text for run command
 */
export function runHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx run <script> [-- args...]

Options:
  -h, --help     Display this message

Description:
  Run a script from package.json. Arguments after -- are passed to the script.

Examples:
  $ npmx run build
  $ npmx run test -- --watch
  $ npmx run start
`
}

/**
 * Help text for exec command
 */
export function execHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx exec <command> [args...]

Options:
  -p, --package=<pkg>   Package to use
  -c, --call=<script>   Call package script
  --yes                 Skip confirmation
  -h, --help            Display this message

Description:
  Execute a package binary. Downloads if not installed.

Examples:
  $ npmx exec cowsay hello
  $ npmx exec -p typescript tsc --init
  $ npmx exec create-next-app my-app
`
}

/**
 * Help text for init command
 */
export function initHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx init [options]

Options:
  -y, --yes      Use defaults
  --scope=<org>  Create scoped package
  -h, --help     Display this message

Description:
  Create a new package.json file.

Examples:
  $ npmx init
  $ npmx init -y
  $ npmx init --scope=@myorg
`
}

/**
 * Help text for publish command
 */
export function publishHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx publish [folder]

Options:
  --tag=<tag>         Publish with tag (default: latest)
  --access=<access>   Set access level (public/restricted)
  --dry-run           Don't actually publish
  --registry=<url>    Use custom registry
  -h, --help          Display this message

Description:
  Publish package to npm registry.

Examples:
  $ npmx publish
  $ npmx publish --tag=next
  $ npmx publish --dry-run
`
}

/**
 * Help text for version command
 */
export function versionHelp(): string {
  return `npmx/${VERSION}

Usage:
  $ npmx version [bump]

Arguments:
  bump   Version bump type: major, minor, patch, premajor, preminor, prepatch, prerelease
         Or explicit version: 1.2.3

Options:
  --preid=<id>   Prerelease identifier
  -m, --message  Git commit message
  --no-git-tag   Skip git tagging
  -h, --help     Display this message

Description:
  Bump package version.

Examples:
  $ npmx version patch       # 1.0.0 -> 1.0.1
  $ npmx version minor       # 1.0.0 -> 1.1.0
  $ npmx version 2.0.0       # Set to 2.0.0
`
}

/**
 * Get help text for a specific command
 */
export function getCommandHelp(command: string): string | null {
  switch (command) {
    case 'install':
    case 'i':
    case 'add':
      return installHelp()
    case 'uninstall':
    case 'rm':
    case 'remove':
      return uninstallHelp()
    case 'list':
    case 'ls':
      return listHelp()
    case 'search':
      return searchHelp()
    case 'info':
    case 'view':
    case 'show':
      return infoHelp()
    case 'run':
      return runHelp()
    case 'exec':
    case 'x':
      return execHelp()
    case 'init':
      return initHelp()
    case 'publish':
      return publishHelp()
    case 'version':
      return versionHelp()
    default:
      return null
  }
}
