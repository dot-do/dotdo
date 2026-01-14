/**
 * Extended Utility Commands
 *
 * Native implementations for extended utility commands:
 * - env: Run with modified environment
 * - id: Print user/group identity
 * - uname: Print system info
 * - timeout: Run command with time limit
 * - tac: Reverse line order
 * - shuf: Shuffle lines (Fisher-Yates)
 *
 * @module bashx/do/commands/extended-utils
 */

// ============================================================================
// ENV COMMAND
// ============================================================================

/**
 * Options for env command
 */
export interface EnvOptions {
  /** Start with empty environment (-i) */
  ignoreEnvironment?: boolean
  /** Environment variables to set (VAR=val) */
  variables?: Record<string, string>
  /** Unset these variables (-u VAR) */
  unset?: string[]
  /** Change to directory (-C) */
  chdir?: string
  /** Command and arguments to execute */
  command?: string[]
}

/**
 * Parse env command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed env options
 *
 * @example
 * ```typescript
 * parseEnvArgs(['-i', 'PATH=/usr/bin', 'ls'])
 * // => { ignoreEnvironment: true, variables: { PATH: '/usr/bin' }, command: ['ls'] }
 * ```
 */
export function parseEnvArgs(args: string[]): EnvOptions {
  const options: EnvOptions = {
    ignoreEnvironment: false,
    variables: {},
    unset: [],
    command: [],
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-i' || arg === '--ignore-environment') {
      options.ignoreEnvironment = true
      i++
    } else if (arg === '-u' || arg === '--unset') {
      if (args[i + 1]) {
        options.unset!.push(args[i + 1])
        i += 2
      } else {
        i++
      }
    } else if (arg.startsWith('-u')) {
      // Handle -uVAR form
      options.unset!.push(arg.slice(2))
      i++
    } else if (arg === '-C' || arg === '--chdir') {
      if (args[i + 1]) {
        options.chdir = args[i + 1]
        i += 2
      } else {
        i++
      }
    } else if (arg.includes('=') && !arg.startsWith('-')) {
      // VAR=value assignment
      const eqIdx = arg.indexOf('=')
      const varName = arg.slice(0, eqIdx)
      const varValue = arg.slice(eqIdx + 1)
      options.variables![varName] = varValue
      i++
    } else if (arg === '--') {
      // End of options, rest is command
      options.command = args.slice(i + 1)
      break
    } else if (!arg.startsWith('-')) {
      // Start of command
      options.command = args.slice(i)
      break
    } else {
      // Unknown option, treat as command
      options.command = args.slice(i)
      break
    }
  }

  return options
}

/**
 * Execute env command - run with modified environment
 *
 * When called with no command, prints the environment.
 * When called with a command, runs it with the modified environment.
 *
 * @param baseEnv - Base environment to start with
 * @param options - Env options
 * @returns Modified environment or result of command execution
 *
 * @example
 * ```typescript
 * // Print modified environment
 * executeEnv({ HOME: '/root' }, { variables: { FOO: 'bar' } })
 * // => { env: { HOME: '/root', FOO: 'bar' }, command: undefined }
 *
 * // Prepare environment for command
 * executeEnv({}, { ignoreEnvironment: true, variables: { PATH: '/bin' } })
 * // => { env: { PATH: '/bin' }, command: undefined }
 * ```
 */
export function executeEnv(
  baseEnv: Record<string, string>,
  options: EnvOptions
): { env: Record<string, string>; command?: string[] } {
  // Start with empty or base environment
  let env: Record<string, string> = options.ignoreEnvironment ? {} : { ...baseEnv }

  // Unset specified variables
  if (options.unset) {
    for (const varName of options.unset) {
      delete env[varName]
    }
  }

  // Set new variables
  if (options.variables) {
    env = { ...env, ...options.variables }
  }

  return {
    env,
    command: options.command && options.command.length > 0 ? options.command : undefined,
  }
}

/**
 * Format environment for output
 *
 * @param env - Environment variables
 * @returns Formatted string (one VAR=value per line)
 */
export function formatEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + (Object.keys(env).length > 0 ? '\n' : '')
}

// ============================================================================
// ID COMMAND
// ============================================================================

/**
 * Options for id command
 */
export interface IdOptions {
  /** Print only effective user ID (-u) */
  user?: boolean
  /** Print only effective group ID (-g) */
  group?: boolean
  /** Print name instead of number (-n) */
  name?: boolean
  /** Print real ID instead of effective (-r) */
  real?: boolean
  /** Print all groups (-G) */
  groups?: boolean
  /** User to query (optional) */
  username?: string
}

/**
 * Identity information structure
 */
export interface IdentityInfo {
  uid: number
  gid: number
  username: string
  groupname: string
  groups: Array<{ gid: number; name: string }>
  euid?: number
  egid?: number
}

/**
 * Parse id command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed id options
 */
export function parseIdArgs(args: string[]): IdOptions {
  const options: IdOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '-u' || arg === '--user') {
      options.user = true
    } else if (arg === '-g' || arg === '--group') {
      options.group = true
    } else if (arg === '-n' || arg === '--name') {
      options.name = true
    } else if (arg === '-r' || arg === '--real') {
      options.real = true
    } else if (arg === '-G' || arg === '--groups') {
      options.groups = true
    } else if (!arg.startsWith('-')) {
      options.username = arg
    }
  }

  return options
}

/**
 * Execute id command - print user/group identity
 *
 * @param identity - Identity information to format
 * @param options - Id options
 * @returns Formatted identity string
 *
 * @example
 * ```typescript
 * const identity = { uid: 1000, gid: 1000, username: 'user', groupname: 'user', groups: [] }
 *
 * executeId(identity, {})
 * // => 'uid=1000(user) gid=1000(user) groups=1000(user)'
 *
 * executeId(identity, { user: true })
 * // => '1000'
 *
 * executeId(identity, { user: true, name: true })
 * // => 'user'
 * ```
 */
export function executeId(identity: IdentityInfo, options: IdOptions = {}): string {
  // Handle -G (all groups)
  if (options.groups) {
    if (options.name) {
      return identity.groups.map(g => g.name).join(' ')
    }
    return identity.groups.map(g => g.gid).join(' ')
  }

  // Handle -u (user)
  if (options.user) {
    const uid = options.real ? identity.uid : (identity.euid ?? identity.uid)
    if (options.name) {
      return identity.username
    }
    return String(uid)
  }

  // Handle -g (group)
  if (options.group) {
    const gid = options.real ? identity.gid : (identity.egid ?? identity.gid)
    if (options.name) {
      return identity.groupname
    }
    return String(gid)
  }

  // Default: full output
  const parts: string[] = []
  parts.push(`uid=${identity.uid}(${identity.username})`)
  parts.push(`gid=${identity.gid}(${identity.groupname})`)

  const groupsStr = identity.groups.map(g => `${g.gid}(${g.name})`).join(',')
  parts.push(`groups=${groupsStr || `${identity.gid}(${identity.groupname})`}`)

  return parts.join(' ')
}

/**
 * Default identity for Workers environment
 */
export const DEFAULT_WORKER_IDENTITY: IdentityInfo = {
  uid: 1000,
  gid: 1000,
  username: 'worker',
  groupname: 'worker',
  groups: [{ gid: 1000, name: 'worker' }],
}

// ============================================================================
// UNAME COMMAND
// ============================================================================

/**
 * Options for uname command
 */
export interface UnameOptions {
  /** Print all (-a) */
  all?: boolean
  /** Print kernel name (-s) */
  kernelName?: boolean
  /** Print node name (-n) */
  nodeName?: boolean
  /** Print kernel release (-r) */
  kernelRelease?: boolean
  /** Print kernel version (-v) */
  kernelVersion?: boolean
  /** Print machine hardware name (-m) */
  machine?: boolean
  /** Print processor type (-p) */
  processor?: boolean
  /** Print hardware platform (-i) */
  hardwarePlatform?: boolean
  /** Print operating system (-o) */
  operatingSystem?: boolean
}

/**
 * System information structure
 */
export interface SystemInfo {
  kernelName: string
  nodeName: string
  kernelRelease: string
  kernelVersion: string
  machine: string
  processor: string
  hardwarePlatform: string
  operatingSystem: string
}

/**
 * Parse uname command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed uname options
 */
export function parseUnameArgs(args: string[]): UnameOptions {
  const options: UnameOptions = {}

  for (const arg of args) {
    if (arg === '-a' || arg === '--all') {
      options.all = true
    } else if (arg === '-s' || arg === '--kernel-name') {
      options.kernelName = true
    } else if (arg === '-n' || arg === '--nodename') {
      options.nodeName = true
    } else if (arg === '-r' || arg === '--kernel-release') {
      options.kernelRelease = true
    } else if (arg === '-v' || arg === '--kernel-version') {
      options.kernelVersion = true
    } else if (arg === '-m' || arg === '--machine') {
      options.machine = true
    } else if (arg === '-p' || arg === '--processor') {
      options.processor = true
    } else if (arg === '-i' || arg === '--hardware-platform') {
      options.hardwarePlatform = true
    } else if (arg === '-o' || arg === '--operating-system') {
      options.operatingSystem = true
    }
  }

  // If no options specified, default to -s
  const hasAnyOption = options.all || options.kernelName || options.nodeName ||
    options.kernelRelease || options.kernelVersion || options.machine ||
    options.processor || options.hardwarePlatform || options.operatingSystem

  if (!hasAnyOption) {
    options.kernelName = true
  }

  return options
}

/**
 * Execute uname command - print system information
 *
 * @param sysinfo - System information
 * @param options - Uname options
 * @returns Formatted system information string
 *
 * @example
 * ```typescript
 * const sysinfo = {
 *   kernelName: 'CloudflareWorkers',
 *   nodeName: 'edge',
 *   kernelRelease: '1.0.0',
 *   kernelVersion: '#1 SMP',
 *   machine: 'wasm32',
 *   processor: 'wasm32',
 *   hardwarePlatform: 'wasm32',
 *   operatingSystem: 'CloudflareWorkers'
 * }
 *
 * executeUname(sysinfo, {})
 * // => 'CloudflareWorkers'
 *
 * executeUname(sysinfo, { all: true })
 * // => 'CloudflareWorkers edge 1.0.0 #1 SMP wasm32 wasm32 wasm32 CloudflareWorkers'
 * ```
 */
export function executeUname(sysinfo: SystemInfo, options: UnameOptions = {}): string {
  const parts: string[] = []

  // Check if any option is specified
  const hasAnyOption = options.all || options.kernelName || options.nodeName ||
    options.kernelRelease || options.kernelVersion || options.machine ||
    options.processor || options.hardwarePlatform || options.operatingSystem

  // Default to kernel name if no options specified
  const effectiveOptions = hasAnyOption ? options : { ...options, kernelName: true }

  if (effectiveOptions.all) {
    parts.push(
      sysinfo.kernelName,
      sysinfo.nodeName,
      sysinfo.kernelRelease,
      sysinfo.kernelVersion,
      sysinfo.machine,
      sysinfo.processor,
      sysinfo.hardwarePlatform,
      sysinfo.operatingSystem
    )
  } else {
    if (effectiveOptions.kernelName) parts.push(sysinfo.kernelName)
    if (effectiveOptions.nodeName) parts.push(sysinfo.nodeName)
    if (effectiveOptions.kernelRelease) parts.push(sysinfo.kernelRelease)
    if (effectiveOptions.kernelVersion) parts.push(sysinfo.kernelVersion)
    if (effectiveOptions.machine) parts.push(sysinfo.machine)
    if (effectiveOptions.processor) parts.push(sysinfo.processor)
    if (effectiveOptions.hardwarePlatform) parts.push(sysinfo.hardwarePlatform)
    if (effectiveOptions.operatingSystem) parts.push(sysinfo.operatingSystem)
  }

  return parts.join(' ')
}

/**
 * Default system info for Cloudflare Workers environment
 */
export const DEFAULT_WORKER_SYSINFO: SystemInfo = {
  kernelName: 'CloudflareWorkers',
  nodeName: 'edge',
  kernelRelease: '1.0.0',
  kernelVersion: '#1 SMP',
  machine: 'wasm32',
  processor: 'wasm32',
  hardwarePlatform: 'wasm32',
  operatingSystem: 'CloudflareWorkers',
}

// ============================================================================
// TIMEOUT COMMAND (Extended version with more options)
// ============================================================================

/**
 * Options for extended timeout command
 */
export interface ExtendedTimeoutOptions {
  /** Duration before sending signal */
  duration: string
  /** Duration before sending KILL after initial signal (-k) */
  killAfter?: string
  /** Signal to send (name or number, -s) */
  signal?: string | number
  /** Use 128+signal as exit code instead of 124 (--preserve-status) */
  preserveStatus?: boolean
  /** Run command in foreground (--foreground) */
  foreground?: boolean
  /** Print verbose timeout message (-v) */
  verbose?: boolean
}

/**
 * Time unit multipliers in milliseconds
 */
const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
}

/**
 * Signal name to number mapping
 */
const SIGNAL_MAP: Record<string, number> = {
  TERM: 15,
  SIGTERM: 15,
  KILL: 9,
  SIGKILL: 9,
  INT: 2,
  SIGINT: 2,
  HUP: 1,
  SIGHUP: 1,
  QUIT: 3,
  SIGQUIT: 3,
  ALRM: 14,
  SIGALRM: 14,
  USR1: 10,
  SIGUSR1: 10,
  USR2: 12,
  SIGUSR2: 12,
}

/**
 * Parse duration string to milliseconds
 *
 * @param duration - Duration string (e.g., '5', '1.5s', '2m', '1h')
 * @returns Duration in milliseconds
 * @throws Error if format is invalid
 */
export function parseTimeoutDuration(duration: string): number {
  if (duration === 'infinity') {
    return Infinity
  }

  const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/)
  if (!match) {
    throw new Error(`Invalid duration: ${duration}`)
  }

  const value = parseFloat(match[1])
  const unit = match[2] || 's'

  return value * (TIME_UNIT_MS[unit] ?? 1000)
}

/**
 * Parse signal name or number to signal number
 *
 * @param signal - Signal name (e.g., 'TERM', 'SIGKILL') or number
 * @returns Signal number
 */
export function parseSignal(signal: string | number): number {
  if (typeof signal === 'number') {
    return signal
  }
  return SIGNAL_MAP[signal.toUpperCase()] ?? (parseInt(signal, 10) || 15)
}

/**
 * Parse timeout command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed timeout options and command
 */
export function parseTimeoutArgs(args: string[]): { options: ExtendedTimeoutOptions; command: string[] } {
  const options: ExtendedTimeoutOptions = {
    duration: '',
    preserveStatus: false,
    foreground: false,
    verbose: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-k' || arg === '--kill-after') {
      options.killAfter = args[++i]
      i++
    } else if (arg.startsWith('-k')) {
      options.killAfter = arg.slice(2)
      i++
    } else if (arg === '-s' || arg === '--signal') {
      options.signal = args[++i]
      i++
    } else if (arg.startsWith('-s')) {
      options.signal = arg.slice(2)
      i++
    } else if (arg === '--preserve-status') {
      options.preserveStatus = true
      i++
    } else if (arg === '--foreground') {
      options.foreground = true
      i++
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true
      i++
    } else if (arg === '--') {
      // Duration should already be set, rest is command
      return { options, command: args.slice(i + 1) }
    } else if (!arg.startsWith('-') && !options.duration) {
      options.duration = arg
      i++
    } else {
      // Start of command
      return { options, command: args.slice(i) }
    }
  }

  return { options, command: [] }
}

/**
 * Execute timeout command wrapper
 *
 * This provides the timeout logic; the actual command execution
 * is handled by the executor that calls this.
 *
 * @param options - Timeout options
 * @param commandExecutor - Function to execute the command
 * @returns Promise with result including timedOut flag
 */
export async function executeTimeout<
  T extends { exitCode: number; stdout: string; stderr: string }
>(
  options: ExtendedTimeoutOptions,
  command: string,
  commandExecutor: (cmd: string) => Promise<T>
): Promise<T & { timedOut: boolean }> {
  // Parse timeout duration
  let timeoutMs: number
  try {
    timeoutMs = parseTimeoutDuration(options.duration)
  } catch {
    return {
      exitCode: 125,
      stdout: '',
      stderr: `timeout: invalid time interval '${options.duration}'`,
      timedOut: false,
    } as T & { timedOut: boolean }
  }

  // Determine signal to use
  const signalNum = options.signal ? parseSignal(options.signal) : 15

  // Create abort controller for timeout
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    // Execute command with race against timeout
    const result = await Promise.race([
      commandExecutor(command),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('TIMEOUT'))
        })
      }),
    ])

    clearTimeout(timer)
    return { ...result, timedOut: false }
  } catch (error) {
    clearTimeout(timer)

    if (timedOut) {
      const exitCode = options.preserveStatus ? 128 + signalNum : 124
      let stderr = ''
      if (options.verbose) {
        stderr = `timeout: sending signal ${signalNum === 9 ? 'KILL' : 'TERM'} to command '${command}'`
      }

      // SIGKILL exit code is 137 (128 + 9)
      const finalExitCode = signalNum === 9 ? 137 : exitCode

      return {
        exitCode: finalExitCode,
        stdout: '',
        stderr,
        timedOut: true,
      } as T & { timedOut: boolean }
    }

    // Re-throw non-timeout errors
    throw error
  }
}

// ============================================================================
// TAC COMMAND
// ============================================================================

/**
 * Options for tac command
 */
export interface TacOptions {
  /** Line separator (default: newline) */
  separator?: string
  /** Attach separator before record instead of after (-b) */
  before?: boolean
  /** Interpret separator as regex (-r) */
  regex?: boolean
}

/**
 * Parse tac command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed options and file paths
 */
export function parseTacArgs(args: string[]): { options: TacOptions; files: string[] } {
  const options: TacOptions = {}
  const files: string[] = []

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-s' || arg === '--separator') {
      options.separator = args[++i]
      i++
    } else if (arg.startsWith('-s')) {
      options.separator = arg.slice(2)
      i++
    } else if (arg === '-b' || arg === '--before') {
      options.before = true
      i++
    } else if (arg === '-r' || arg === '--regex') {
      options.regex = true
      i++
    } else if (arg === '--') {
      files.push(...args.slice(i + 1))
      break
    } else if (!arg.startsWith('-')) {
      files.push(arg)
      i++
    } else {
      i++
    }
  }

  return { options, files }
}

/**
 * Execute tac command - reverse lines in file(s)
 *
 * @param input - Input string to reverse
 * @param options - Tac options
 * @returns Reversed content
 *
 * @example
 * ```typescript
 * executeTac('line1\nline2\nline3\n')
 * // => 'line3\nline2\nline1\n'
 *
 * executeTac('a|b|c|', { separator: '|' })
 * // => 'c|b|a|'
 * ```
 */
export function executeTac(input: string, options: TacOptions = {}): string {
  const separator = options.separator ?? '\n'

  // Split input by separator
  let parts: string[]
  if (options.regex) {
    parts = input.split(new RegExp(separator))
  } else {
    parts = input.split(separator)
  }

  // Handle trailing empty element from trailing separator
  const hadTrailingSep = parts[parts.length - 1] === ''
  if (hadTrailingSep) {
    parts.pop()
  }

  // Reverse the parts
  parts.reverse()

  // Reconstruct with separator
  if (options.before) {
    // Separator before each record
    return parts.map(p => separator + p).join('')
  }

  // Separator after each record (default)
  return parts.join(separator) + (parts.length > 0 ? separator : '')
}

// ============================================================================
// SHUF COMMAND (Extended version from math-control)
// ============================================================================

/**
 * Options for extended shuf command
 */
export interface ExtendedShufOptions {
  /** Maximum number of items to output (-n) */
  count?: number
  /** Allow picking the same item multiple times (-r) */
  replacement?: boolean
  /** Generate integers in range [start, end] (-i LO-HI) */
  inputRange?: { start: number; end: number }
  /** Echo these arguments (-e) */
  echoArgs?: string[]
  /** Output file path (-o) */
  outputFile?: string
  /** Random source file (--random-source) */
  randomSource?: string
  /** Zero-terminated lines (-z) */
  zeroTerminated?: boolean
}

/**
 * Parse shuf command arguments
 *
 * @param args - Command line arguments
 * @returns Parsed options and input files
 */
export function parseShufArgs(args: string[]): { options: ExtendedShufOptions; files: string[] } {
  const options: ExtendedShufOptions = {}
  const files: string[] = []
  let echoMode = false

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-n' || arg === '--head-count') {
      options.count = parseInt(args[++i], 10)
      i++
    } else if (arg.startsWith('-n')) {
      options.count = parseInt(arg.slice(2), 10)
      i++
    } else if (arg === '-r' || arg === '--repeat') {
      options.replacement = true
      i++
    } else if (arg === '-i' || arg === '--input-range') {
      const range = args[++i]
      const [lo, hi] = range.split('-').map(Number)
      options.inputRange = { start: lo, end: hi }
      i++
    } else if (arg.startsWith('-i')) {
      const range = arg.slice(2)
      const [lo, hi] = range.split('-').map(Number)
      options.inputRange = { start: lo, end: hi }
      i++
    } else if (arg === '-e' || arg === '--echo') {
      echoMode = true
      i++
    } else if (arg === '-o' || arg === '--output') {
      options.outputFile = args[++i]
      i++
    } else if (arg.startsWith('-o')) {
      options.outputFile = arg.slice(2)
      i++
    } else if (arg === '--random-source') {
      options.randomSource = args[++i]
      i++
    } else if (arg === '-z' || arg === '--zero-terminated') {
      options.zeroTerminated = true
      i++
    } else if (arg === '--') {
      if (echoMode) {
        options.echoArgs = args.slice(i + 1)
      } else {
        files.push(...args.slice(i + 1))
      }
      break
    } else if (!arg.startsWith('-')) {
      if (echoMode) {
        options.echoArgs = options.echoArgs || []
        options.echoArgs.push(arg)
      } else {
        files.push(arg)
      }
      i++
    } else {
      i++
    }
  }

  return { options, files }
}

/**
 * Fisher-Yates shuffle algorithm
 *
 * @param array - Array to shuffle (mutated in place)
 * @returns The shuffled array
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

/**
 * Sample with replacement
 *
 * @param array - Source array
 * @param n - Number of items to sample
 * @returns Sampled items (may contain duplicates)
 */
function sampleWithReplacement<T>(array: T[], n: number): T[] {
  const result: T[] = []
  for (let i = 0; i < n; i++) {
    result.push(array[Math.floor(Math.random() * array.length)])
  }
  return result
}

/**
 * Execute shuf command - shuffle/randomize lines
 *
 * @param lines - Input lines to shuffle (from stdin/file)
 * @param options - Shuf options
 * @returns Shuffled output
 *
 * @example
 * ```typescript
 * executeShuf(['a', 'b', 'c'], {})
 * // => Random permutation of ['a', 'b', 'c']
 *
 * executeShuf([], { inputRange: { start: 1, end: 10 } })
 * // => Random permutation of 1-10
 *
 * executeShuf([], { echoArgs: ['red', 'green', 'blue'], count: 1 })
 * // => One random color
 * ```
 */
export function executeShuf(
  lines: string[],
  options: ExtendedShufOptions = {}
): { result: string; exitCode: number } {
  let items: string[]

  // Determine input source
  if (options.inputRange) {
    const { start, end } = options.inputRange
    items = []
    for (let i = start; i <= end; i++) {
      items.push(String(i))
    }
  } else if (options.echoArgs && options.echoArgs.length > 0) {
    items = options.echoArgs
  } else {
    items = lines.filter(l => l.length > 0)
  }

  // Handle -n 0
  if (options.count === 0) {
    return { result: '', exitCode: 0 }
  }

  let result: string[]

  if (options.replacement) {
    // With replacement - can pick same item multiple times
    const count = options.count ?? items.length
    result = sampleWithReplacement(items, count)
  } else {
    // Without replacement - Fisher-Yates shuffle
    result = fisherYatesShuffle([...items])

    // Limit to count if specified
    if (options.count !== undefined) {
      result = result.slice(0, Math.min(options.count, result.length))
    }
  }

  const terminator = options.zeroTerminated ? '\0' : '\n'
  return {
    result: result.join(terminator) + (result.length > 0 ? terminator : ''),
    exitCode: 0,
  }
}

// ============================================================================
// COMMAND SET FOR TIERED EXECUTOR
// ============================================================================

/**
 * Set of extended utility commands handled by this module
 */
export const EXTENDED_UTILS_COMMANDS = new Set([
  'env', 'id', 'uname', 'timeout', 'tac', 'shuf',
])

/**
 * Check if a command is an extended utility command
 */
export function isExtendedUtilsCommand(cmd: string): boolean {
  return EXTENDED_UTILS_COMMANDS.has(cmd)
}
