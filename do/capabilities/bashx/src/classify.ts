/**
 * Input Classification Module
 *
 * Classifies input as either a bash command or natural language intent.
 * Also provides command classification by operational category.
 * This is a critical component for AI-enhanced bash execution.
 */

// ============================================================================
// Command Classification Types and Implementation
// ============================================================================

/**
 * Command categories for classification
 */
export type CommandCategory =
  | 'file'
  | 'process'
  | 'network'
  | 'system'
  | 'package'
  | 'development'
  | 'git'
  | 'container'
  | 'unknown'

/**
 * File operations
 */
export type FileOperation = 'read' | 'write' | 'delete' | 'copy' | 'move' | 'list' | 'search' | 'permission'

/**
 * Process operations
 */
export type ProcessOperation = 'kill' | 'monitor' | 'control'

/**
 * Network operations
 */
export type NetworkOperation = 'fetch' | 'listen' | 'connect' | 'diagnostic'

/**
 * System operations
 */
export type SystemOperation = 'mount' | 'service' | 'user' | 'info'

/**
 * Package operations
 */
export type PackageOperation = 'install' | 'uninstall' | 'update' | 'upgrade' | 'search'

/**
 * Development operations
 */
export type DevelopmentOperation = 'build' | 'test' | 'lint' | 'format' | 'run'

/**
 * Git operations
 */
export type GitOperation = 'commit' | 'push' | 'pull' | 'branch' | 'merge' | 'stage' | 'status' | 'clone'

/**
 * Container operations
 */
export type ContainerOperation = 'run' | 'build' | 'compose' | 'image' | 'status' | 'control' | 'orchestrate'

/**
 * All operation types
 */
export type CommandOperation =
  | FileOperation
  | ProcessOperation
  | NetworkOperation
  | SystemOperation
  | PackageOperation
  | DevelopmentOperation
  | GitOperation
  | ContainerOperation
  | 'unknown'

/**
 * Risk levels for commands
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/**
 * Risk assessment for a command
 */
export interface RiskAssessment {
  level: RiskLevel
  reason: string
}

/**
 * Parsed command structure
 */
export interface ParsedCommand {
  binary: string
  subcommand?: string
  args: string[]
  flags: string[]
}

/**
 * Individual operation classification for compound commands
 */
export interface OperationClassification {
  category: CommandCategory
  operation: CommandOperation
}

/**
 * Result of classifying a command
 */
export interface CommandClassificationResult {
  category: CommandCategory
  operation: CommandOperation
  command: string
  confidence: number
  parsed: ParsedCommand
  risk: RiskAssessment
  compound?: boolean
  operations?: OperationClassification[]
  elevated?: boolean
}

// ============================================================================
// Command Classification Data
// ============================================================================

/**
 * File operations mapping
 */
const FILE_OPS: Record<string, FileOperation> = {
  // Read operations
  cat: 'read',
  head: 'read',
  tail: 'read',
  less: 'read',
  more: 'read',
  // Write operations
  touch: 'write',
  mkdir: 'write',
  tee: 'write',
  // Delete operations
  rm: 'delete',
  rmdir: 'delete',
  unlink: 'delete',
  // Copy operations
  cp: 'copy',
  // Move operations
  mv: 'move',
  // List operations
  ls: 'list',
  ll: 'list',
  dir: 'list',
  // Search operations
  find: 'search',
  locate: 'search',
  // Permission operations
  chmod: 'permission',
  chown: 'permission',
  chgrp: 'permission',
}

/**
 * Process operations mapping
 */
const PROCESS_OPS: Record<string, ProcessOperation> = {
  kill: 'kill',
  pkill: 'kill',
  killall: 'kill',
  ps: 'monitor',
  top: 'monitor',
  htop: 'monitor',
  pgrep: 'monitor',
  nohup: 'control',
  nice: 'control',
  renice: 'control',
}

/**
 * Network operations mapping
 */
const NETWORK_OPS: Record<string, NetworkOperation> = {
  curl: 'fetch',
  wget: 'fetch',
  ssh: 'connect',
  scp: 'connect',
  rsync: 'connect',
  telnet: 'connect',
  nc: 'connect', // Default, but can be listen with -l
  netcat: 'connect',
  socat: 'listen',
  ping: 'diagnostic',
  traceroute: 'diagnostic',
  netstat: 'diagnostic',
  ss: 'diagnostic',
  nslookup: 'diagnostic',
  dig: 'diagnostic',
  ifconfig: 'diagnostic',
  ip: 'diagnostic',
}

/**
 * System operations mapping
 */
const SYSTEM_OPS: Record<string, SystemOperation> = {
  mount: 'mount',
  umount: 'mount',
  systemctl: 'service',
  service: 'service',
  useradd: 'user',
  userdel: 'user',
  usermod: 'user',
  passwd: 'user',
  uname: 'info',
  df: 'info',
  free: 'info',
  uptime: 'info',
  lsblk: 'info',
  dmesg: 'info',
  hostname: 'info',
}

/**
 * Package managers and their operations
 */
const PACKAGE_MANAGERS = new Set([
  'apt', 'apt-get', 'yum', 'dnf', 'brew', 'npm', 'pnpm', 'yarn',
  'pip', 'pip3', 'cargo', 'go', 'gem', 'composer', 'nuget',
])

/**
 * Package operation keywords
 */
const PACKAGE_OPS: Record<string, PackageOperation> = {
  install: 'install',
  i: 'install',
  add: 'install',
  remove: 'uninstall',
  uninstall: 'uninstall',
  update: 'update',
  upgrade: 'upgrade',
  search: 'search',
}

/**
 * Development tools mapping
 */
const DEV_TOOLS: Record<string, DevelopmentOperation> = {
  make: 'build',
  gcc: 'build',
  'g++': 'build',
  clang: 'build',
  rustc: 'build',
  tsc: 'build',
  pytest: 'test',
  jest: 'test',
  vitest: 'test',
  mocha: 'test',
  eslint: 'lint',
  pylint: 'lint',
  flake8: 'lint',
  rubocop: 'lint',
  prettier: 'lint', // Default, but can be format with --write
  black: 'format',
  gofmt: 'format',
  node: 'run',
  python: 'run',
  python3: 'run',
  ruby: 'run',
  perl: 'run',
}

/**
 * Git subcommand operations
 */
const GIT_OPS: Record<string, GitOperation> = {
  commit: 'commit',
  push: 'push',
  pull: 'pull',
  fetch: 'pull',
  branch: 'branch',
  checkout: 'branch', // with -b
  switch: 'branch',   // with -c
  merge: 'merge',
  rebase: 'merge',
  'cherry-pick': 'merge',
  add: 'stage',
  reset: 'stage',
  stash: 'stage',
  status: 'status',
  log: 'status',
  diff: 'status',
  show: 'status',
  clone: 'clone',
  init: 'clone',
}

/**
 * Docker subcommand operations
 */
const DOCKER_OPS: Record<string, ContainerOperation> = {
  run: 'run',
  exec: 'run',
  build: 'build',
  pull: 'image',
  push: 'image',
  images: 'image',
  rmi: 'image',
  ps: 'status',
  logs: 'status',
  inspect: 'status',
  stop: 'control',
  start: 'control',
  restart: 'control',
  kill: 'control',
  rm: 'control',
  compose: 'compose',
}

/**
 * Parse a command string into its components
 */
function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim()
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null
  let escape = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]!

    if (escape) {
      current += char
      escape = false
      continue
    }

    if (char === '\\') {
      escape = true
      current += char
      continue
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null
      } else if (!inQuote) {
        inQuote = char
      }
      current += char
      continue
    }

    if (!inQuote && /\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  const binary = tokens[0] || ''
  const rest = tokens.slice(1)

  const flags: string[] = []
  const args: string[] = []
  let subcommand: string | undefined

  for (const token of rest) {
    if (token.startsWith('-')) {
      flags.push(token)
    } else if (!subcommand && !token.includes('/') && !token.includes('.')) {
      // First non-flag, non-path token could be a subcommand
      subcommand = token
    } else {
      args.push(token)
    }
  }

  // For commands that don't have subcommands, move subcommand to args
  if (subcommand && !['git', 'docker', 'podman', 'kubectl', 'helm', 'npm', 'yarn', 'pnpm', 'pip', 'pip3', 'apt', 'apt-get', 'yum', 'dnf', 'brew', 'cargo', 'go', 'systemctl', 'service'].includes(binary)) {
    args.unshift(subcommand)
    subcommand = undefined
  }

  return { binary, subcommand, args, flags }
}

/**
 * Check if command has output redirect (writes to file)
 */
function hasOutputRedirect(command: string): boolean {
  // Match > or >> not preceded by 2 (stderr redirect)
  return /(?<![2&])\s*>{1,2}\s*\S/.test(command)
}

/**
 * Check if command has sudo prefix
 */
function hasSudo(command: string): boolean {
  return /^\s*(sudo|doas)\s+/.test(command)
}

/**
 * Check if command has env prefix
 */
function hasEnvPrefix(command: string): boolean {
  return /^\s*env\s+\w+=/.test(command)
}

/**
 * Strip prefixes like sudo and env
 */
function stripPrefixes(command: string): string {
  let result = command.trim()

  // Strip sudo/doas
  result = result.replace(/^\s*(sudo|doas)\s+/, '')

  // Strip env VAR=value prefixes
  result = result.replace(/^\s*env\s+(\w+=\S+\s+)+/, '')

  return result.trim()
}

/**
 * Detect if this is a compound command (&&, ||, ;)
 */
function isCompoundCommand(command: string): boolean {
  // Simple check - look for && or || outside of quotes
  let inQuote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null
      } else if (!inQuote) {
        inQuote = char
      }
    } else if (!inQuote) {
      if ((command[i] === '&' && command[i + 1] === '&') ||
        (command[i] === '|' && command[i + 1] === '|')) {
        return true
      }
    }
  }
  return false
}

/**
 * Split compound command into parts
 */
function splitCompoundCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote: string | null = null
  let i = 0

  while (i < command.length) {
    const char = command[i]!

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null
      } else if (!inQuote) {
        inQuote = char
      }
      current += char
      i++
    } else if (!inQuote) {
      if ((command[i] === '&' && command[i + 1] === '&') ||
        (command[i] === '|' && command[i + 1] === '|')) {
        if (current.trim()) {
          parts.push(current.trim())
        }
        current = ''
        i += 2
      } else {
        current += char
        i++
      }
    } else {
      current += char
      i++
    }
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return parts
}

/**
 * Assess risk level of a command
 */
function assessRisk(category: CommandCategory, operation: CommandOperation, parsed: ParsedCommand, command: string): RiskAssessment {
  // Critical risk - system-wide destructive operations
  if (operation === 'delete' && parsed.flags.some(f => f.includes('r') && f.includes('f'))) {
    if (command.includes(' / ') || command.includes(' /\n') || command.endsWith(' /')) {
      return { level: 'critical', reason: 'Recursive force delete on root filesystem' }
    }
    return { level: 'high', reason: 'Recursive force delete operation' }
  }

  // High risk operations
  if (category === 'system' && ['mount', 'service', 'user'].includes(operation)) {
    return { level: 'high', reason: 'System administration operation' }
  }

  if (category === 'process' && operation === 'kill') {
    if (parsed.flags.some(f => f === '-9' || f === '-SIGKILL')) {
      return { level: 'high', reason: 'Force kill operation' }
    }
    return { level: 'medium', reason: 'Process termination' }
  }

  if (category === 'container' && ['control', 'orchestrate'].includes(operation)) {
    return { level: 'medium', reason: 'Container management operation' }
  }

  if (category === 'git' && operation === 'push') {
    if (parsed.flags.some(f => f.includes('force'))) {
      return { level: 'high', reason: 'Force push to remote' }
    }
    return { level: 'medium', reason: 'Pushing changes to remote' }
  }

  // Medium risk
  if (operation === 'delete' || operation === 'write') {
    return { level: 'medium', reason: `File ${operation} operation` }
  }

  if (category === 'package' && ['install', 'uninstall'].includes(operation)) {
    return { level: 'medium', reason: 'Package modification' }
  }

  // Low risk - read-only operations
  if (['read', 'list', 'search', 'monitor', 'status', 'diagnostic', 'info'].includes(operation)) {
    return { level: 'low', reason: 'Read-only operation' }
  }

  return { level: 'low', reason: 'Standard operation' }
}

/**
 * Classify a single command (not compound)
 */
function classifySingleCommand(command: string): { category: CommandCategory; operation: CommandOperation; confidence: number } {
  const stripped = stripPrefixes(command)
  const parsed = parseCommand(stripped)
  const binary = parsed.binary.toLowerCase()

  // Check for output redirect first - makes it a file write
  if (hasOutputRedirect(command)) {
    return { category: 'file', operation: 'write', confidence: 0.9 }
  }

  // File operations
  if (binary in FILE_OPS) {
    return { category: 'file', operation: FILE_OPS[binary]!, confidence: 0.95 }
  }

  // Process operations
  if (binary in PROCESS_OPS) {
    return { category: 'process', operation: PROCESS_OPS[binary]!, confidence: 0.95 }
  }

  // Network operations
  if (binary in NETWORK_OPS) {
    let op = NETWORK_OPS[binary]!
    // nc/netcat with -l is listen
    if ((binary === 'nc' || binary === 'netcat') && parsed.flags.some(f => f.includes('l'))) {
      op = 'listen'
    }
    // socat with TCP-LISTEN is listen
    if (binary === 'socat' && command.includes('LISTEN')) {
      op = 'listen'
    }
    return { category: 'network', operation: op, confidence: 0.95 }
  }

  // System operations
  if (binary in SYSTEM_OPS) {
    return { category: 'system', operation: SYSTEM_OPS[binary]!, confidence: 0.95 }
  }

  // Check for /etc/init.d/ service scripts
  if (binary.startsWith('/etc/init.d/')) {
    return { category: 'system', operation: 'service', confidence: 0.9 }
  }

  // Git operations
  if (binary === 'git') {
    const subcommand = parsed.subcommand?.toLowerCase() || parsed.args[0]?.toLowerCase()
    if (subcommand && subcommand in GIT_OPS) {
      let op = GIT_OPS[subcommand]!
      // git checkout -b or git switch -c creates a branch
      if ((subcommand === 'checkout' && parsed.flags.some(f => f.includes('b'))) ||
        (subcommand === 'switch' && parsed.flags.some(f => f.includes('c')))) {
        op = 'branch'
      }
      return { category: 'git', operation: op, confidence: 0.95 }
    }
    return { category: 'git', operation: 'unknown', confidence: 0.7 }
  }

  // Docker/Podman operations
  if (binary === 'docker' || binary === 'podman') {
    const subcommand = parsed.subcommand?.toLowerCase() || parsed.args[0]?.toLowerCase()
    if (subcommand && subcommand in DOCKER_OPS) {
      return { category: 'container', operation: DOCKER_OPS[subcommand]!, confidence: 0.95 }
    }
    return { category: 'container', operation: 'unknown', confidence: 0.7 }
  }

  // docker-compose
  if (binary === 'docker-compose') {
    return { category: 'container', operation: 'compose', confidence: 0.95 }
  }

  // Kubernetes
  if (binary === 'kubectl' || binary === 'helm') {
    return { category: 'container', operation: 'orchestrate', confidence: 0.95 }
  }

  // Package managers
  if (PACKAGE_MANAGERS.has(binary)) {
    const subcommand = parsed.subcommand?.toLowerCase() || parsed.args[0]?.toLowerCase()

    // npm/yarn/pnpm run commands
    if (['npm', 'yarn', 'pnpm'].includes(binary)) {
      if (subcommand === 'run') {
        const script = parsed.args[0]?.toLowerCase() || parsed.args[1]?.toLowerCase()
        if (script === 'build') return { category: 'development', operation: 'build', confidence: 0.9 }
        if (script === 'test') return { category: 'development', operation: 'test', confidence: 0.9 }
        if (script === 'lint') return { category: 'development', operation: 'lint', confidence: 0.9 }
        if (script === 'dev' || script === 'start') return { category: 'development', operation: 'run', confidence: 0.9 }
        return { category: 'development', operation: 'run', confidence: 0.85 }
      }
      if (subcommand === 'test') return { category: 'development', operation: 'test', confidence: 0.9 }
      if (subcommand === 'start') return { category: 'development', operation: 'run', confidence: 0.9 }
      if (subcommand === 'build') return { category: 'development', operation: 'build', confidence: 0.9 }
    }

    // cargo/go build/test/run
    if (['cargo', 'go'].includes(binary)) {
      if (subcommand === 'build') return { category: 'development', operation: 'build', confidence: 0.95 }
      if (subcommand === 'test') return { category: 'development', operation: 'test', confidence: 0.95 }
      if (subcommand === 'run') return { category: 'development', operation: 'run', confidence: 0.95 }
      if (subcommand === 'fmt') return { category: 'development', operation: 'format', confidence: 0.95 }
      if (subcommand === 'clippy') return { category: 'development', operation: 'lint', confidence: 0.95 }
    }

    // Package operations
    if (subcommand && subcommand in PACKAGE_OPS) {
      // pip install --upgrade is upgrade
      if (subcommand === 'install' && parsed.flags.some(f => f.includes('upgrade'))) {
        return { category: 'package', operation: 'upgrade', confidence: 0.95 }
      }
      return { category: 'package', operation: PACKAGE_OPS[subcommand]!, confidence: 0.95 }
    }

    // Default install for npm install, pip install without subcommand
    if (!subcommand || (binary === 'npm' && subcommand === 'install') || (binary === 'pnpm' && subcommand === 'install')) {
      return { category: 'package', operation: 'install', confidence: 0.9 }
    }

    return { category: 'package', operation: 'unknown', confidence: 0.7 }
  }

  // Development tools
  if (binary in DEV_TOOLS) {
    let op = DEV_TOOLS[binary]!
    // prettier --write is format
    if (binary === 'prettier' && parsed.flags.some(f => f.includes('write'))) {
      op = 'format'
    }
    // prettier --check is lint
    if (binary === 'prettier' && parsed.flags.some(f => f.includes('check'))) {
      op = 'lint'
    }
    return { category: 'development', operation: op, confidence: 0.95 }
  }

  // Common aliases
  if (binary === 'll') {
    return { category: 'file', operation: 'list', confidence: 0.9 }
  }

  // echo with redirect
  if (binary === 'echo' && hasOutputRedirect(command)) {
    return { category: 'file', operation: 'write', confidence: 0.9 }
  }

  // Unknown command
  return { category: 'unknown', operation: 'unknown', confidence: 0.3 }
}

/**
 * Classify a bash command by its operational category.
 *
 * @param command - The bash command to classify
 * @returns Classification result with category, operation, confidence, and metadata
 *
 * @example
 * ```typescript
 * const result = await classifyCommand('git push origin main')
 * // { category: 'git', operation: 'push', confidence: 0.95, ... }
 *
 * const result = await classifyCommand('rm -rf node_modules')
 * // { category: 'file', operation: 'delete', risk: { level: 'high', ... }, ... }
 * ```
 */
export async function classifyCommand(command: string): Promise<CommandClassificationResult> {
  const trimmed = command.trim()

  // Handle empty/whitespace
  if (!trimmed) {
    return {
      category: 'unknown',
      operation: 'unknown',
      command: trimmed,
      confidence: 0,
      parsed: { binary: '', args: [], flags: [] },
      risk: { level: 'low', reason: 'Empty command' },
    }
  }

  const elevated = hasSudo(trimmed)
  const stripped = stripPrefixes(trimmed)

  // Handle env prefix for development commands
  if (hasEnvPrefix(trimmed)) {
    // Strip env and vars, classify the actual command
    const actualCommand = stripped.replace(/^\s*env\s+(\w+=\S+\s+)+/, '').trim()
    const result = await classifyCommand(actualCommand)
    return { ...result, command: trimmed, elevated }
  }

  // Check for compound command
  if (isCompoundCommand(trimmed)) {
    const parts = splitCompoundCommand(stripped)
    const operations: OperationClassification[] = []

    for (const part of parts) {
      const partResult = classifySingleCommand(part)
      operations.push({ category: partResult.category, operation: partResult.operation })
    }

    // Use first command's classification as primary
    const primary = classifySingleCommand(parts[0] || '')
    const parsed = parseCommand(stripped)

    return {
      category: primary.category,
      operation: primary.operation,
      command: trimmed,
      confidence: primary.confidence,
      parsed,
      risk: assessRisk(primary.category, primary.operation, parsed, trimmed),
      compound: true,
      operations,
      ...(elevated && { elevated }),
    }
  }

  // Single command
  const { category, operation, confidence } = classifySingleCommand(stripped)
  const parsed = parseCommand(stripped)

  const result: CommandClassificationResult = {
    category,
    operation,
    command: trimmed,
    confidence,
    parsed,
    risk: assessRisk(category, operation, parsed, trimmed),
  }

  if (elevated) {
    result.elevated = true
  }

  return result
}

/**
 * Alternative interpretation for ambiguous inputs
 */
export interface ClassificationAlternative {
  type: 'command' | 'intent'
  interpretation: string
}

/**
 * Result of classifying user input.
 */
export interface InputClassification {
  /**
   * Type of input detected:
   * - 'command': Valid bash command syntax
   * - 'intent': Natural language request
   * - 'invalid': Empty or invalid input
   */
  type: 'command' | 'intent' | 'invalid'

  /**
   * Confidence score between 0 and 1.
   * Higher values indicate more certainty in the classification.
   */
  confidence: number

  /**
   * The original input (trimmed)
   */
  input: string

  /**
   * Human-readable explanation of the classification decision
   */
  reason: string

  /**
   * Whether the input is ambiguous (could be either command or intent)
   */
  ambiguous: boolean

  /**
   * For intent type: suggested bash command to execute
   */
  suggestedCommand?: string

  /**
   * For ambiguous inputs: alternative interpretations
   */
  alternatives?: ClassificationAlternative[]
}

/**
 * Common bash commands and builtins for detection
 */
const BASH_COMMANDS = new Set([
  // Filesystem
  'ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'cat', 'head', 'tail',
  'less', 'more', 'find', 'locate', 'du', 'df', 'ln', 'chmod', 'chown', 'chgrp', 'dd',
  // Text processing
  'grep', 'awk', 'sed', 'sort', 'uniq', 'wc', 'cut', 'tr', 'diff', 'comm',
  // System
  'ps', 'top', 'kill', 'killall', 'bg', 'fg', 'jobs', 'nohup', 'nice', 'time',
  'date', 'cal', 'uptime', 'whoami', 'who', 'w', 'id', 'groups', 'uname',
  // Network
  'ping', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'netstat', 'ifconfig', 'ip',
  // Package managers
  'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'brew', 'apt', 'apt-get', 'yum', 'dnf',
  // Development
  'git', 'make', 'cmake', 'gcc', 'g++', 'clang', 'rustc', 'cargo', 'go', 'python', 'python3',
  'node', 'deno', 'bun', 'ruby', 'perl', 'java', 'javac',
  // Containers
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm',
  // Shells/Builtins
  'echo', 'printf', 'read', 'export', 'source', 'alias', 'unalias', 'type', 'which',
  'test', 'true', 'false', 'exit', 'return', 'break', 'continue', 'eval', 'exec',
  'set', 'unset', 'shift', 'trap', 'wait', 'history', 'fc',
  // Archive
  'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'bzip2', 'xz',
  // Misc
  'man', 'info', 'help', 'clear', 'reset', 'tee', 'xargs', 'env', 'printenv', 'sleep',
])

/**
 * Words that strongly indicate natural language (not commands)
 */
const NATURAL_LANGUAGE_INDICATORS = [
  // Questions
  'how', 'what', 'which', 'where', 'when', 'why', 'who', 'whom', 'whose',
  // Polite phrases
  'please', 'could', 'would', 'can', 'may', 'might', 'should',
  // Pronouns and articles
  'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'their',
  'me', 'you', 'him', 'her', 'them', 'us',
  // Verbs indicating intent
  'want', 'need', 'wish', 'like', 'prefer', 'help',
  // Conversational
  'show', 'display', 'give', 'tell', 'explain', 'describe',
  // Action descriptors
  'all', 'every', 'each', 'some', 'any', 'most', 'few',
  // Prepositions in conversational context
  'about', 'using', 'with', 'without', 'into', 'onto', 'through',
  // Conjunctions
  'and', 'but', 'because', 'since', 'although', 'however',
  // Foreign common words
  'les', 'fichiers', 'afficher', 'montrer', 'voir',
]

/**
 * Bash shell syntax patterns
 */
const BASH_SYNTAX_PATTERNS = [
  /\|/,                      // Pipe
  /[<>]/,                    // Redirects
  /&&/,                      // AND
  /\|\|/,                    // OR
  /;/,                       // Command separator
  /^\s*for\s+\w+\s+in\b/m,   // for loop
  /^\s*while\s+/m,           // while loop
  /^\s*if\s+/m,              // if statement
  /^\s*case\s+/m,            // case statement
  /<<\s*\w+/,                // Here-doc
  /\$\(/,                    // Command substitution
  /\$\{/,                    // Variable expansion
  /\$\w+/,                   // Variable reference
  /"[^"]*"/,                 // Double-quoted string
  /'[^']*'/,                 // Single-quoted string
  /`[^`]*`/,                 // Backtick substitution
]

/**
 * Flag patterns common in commands
 */
const FLAG_PATTERN = /\s+-{1,2}[a-zA-Z][\w-]*(=\S+)?/

/**
 * Check if input looks like a bash command
 */
function hasCommandSyntax(input: string): boolean {
  // Check for common bash syntax
  for (const pattern of BASH_SYNTAX_PATTERNS) {
    if (pattern.test(input)) {
      return true
    }
  }
  // Check for flags
  if (FLAG_PATTERN.test(input)) {
    return true
  }
  return false
}

/**
 * Check if input contains natural language indicators
 */
function countNaturalLanguageIndicators(input: string): number {
  const words = input.toLowerCase().split(/\s+/)
  let count = 0
  for (const word of words) {
    if (NATURAL_LANGUAGE_INDICATORS.includes(word.replace(/[?.,!]/g, ''))) {
      count++
    }
  }
  return count
}

/**
 * Check if input starts with a known command
 */
function startsWithCommand(input: string): string | null {
  const firstWord = input.split(/\s+/)[0]?.toLowerCase()
  if (firstWord && BASH_COMMANDS.has(firstWord)) {
    return firstWord
  }
  return null
}

/**
 * Detect if input is a question
 */
function isQuestion(input: string): boolean {
  const questionWords = ['how', 'what', 'which', 'where', 'when', 'why', 'who']
  const firstWord = input.toLowerCase().split(/\s+/)[0]?.replace(/[?.,!]/g, '')
  return questionWords.includes(firstWord || '') || input.trim().endsWith('?')
}

/**
 * Detect conversational patterns
 */
function isConversational(input: string): boolean {
  const patterns = [
    /^i\s+(want|need|would like|wish)\s+/i,
    /^(please|could you|would you|can you|may i|can i|help me)\b/i,
    /\bplease\b/i,
    /^(show|display|give|tell)\s+me\b/i,
  ]
  return patterns.some(p => p.test(input))
}

/**
 * Check if single word is ambiguous
 */
function isSingleWordAmbiguous(word: string): boolean {
  const ambiguousSingleWords = new Set([
    'ls', 'list', 'status', 'history', 'test', 'exit', 'pwd', 'cd', 'help',
    'make', 'find', 'cat', 'which', 'type', 'time', 'clear', 'diff',
  ])
  return ambiguousSingleWords.has(word.toLowerCase())
}

/**
 * Suggest a command for natural language intents
 */
function suggestCommand(input: string): string | undefined {
  const lower = input.toLowerCase()

  if (/list\s+(all\s+)?files|show\s+(me\s+)?(all\s+)?files|afficher\s+les\s+fichiers/i.test(lower)) {
    return 'ls -la'
  }
  if (/git\s+history|show\s+(me\s+)?the\s+git\s+history/i.test(lower)) {
    return 'git log'
  }
  if (/disk\s+space|check\s+disk/i.test(lower)) {
    return 'df -h'
  }
  if (/current\s+directory|what\s+is\s+the\s+current\s+directory/i.test(lower)) {
    return 'pwd'
  }
  if (/memory\s+usage/i.test(lower)) {
    return 'free -h'
  }
  if (/(list\s+)?(all\s+)?branches/i.test(lower)) {
    return 'git branch -a'
  }

  return undefined
}

/**
 * Classify input as command or natural language intent.
 *
 * @param input - The user input to classify
 * @returns Classification result with type, confidence, and metadata
 *
 * @example
 * ```typescript
 * const result = await classifyInput('ls -la')
 * // { type: 'command', confidence: 0.95, ... }
 *
 * const result = await classifyInput('show me all files')
 * // { type: 'intent', confidence: 0.9, suggestedCommand: 'ls -la', ... }
 * ```
 */
export async function classifyInput(input: string): Promise<InputClassification> {
  const trimmed = input.trim()

  // Handle empty/whitespace input
  if (!trimmed) {
    return {
      type: 'invalid',
      confidence: 1,
      input: trimmed,
      reason: 'Empty or whitespace-only input',
      ambiguous: false,
    }
  }

  const words = trimmed.split(/\s+/)
  const wordCount = words.length
  const firstCommand = startsWithCommand(trimmed)
  const hasShellSyntax = hasCommandSyntax(trimmed)
  const nlIndicatorCount = countNaturalLanguageIndicators(trimmed)
  const questionLike = isQuestion(trimmed)
  const conversational = isConversational(trimmed)

  // Check for multiline scripts (for loops, while, if, here-doc)
  const isMultiline = trimmed.includes('\n')
  const isScript = /^\s*(for|while|if|case)\b/m.test(trimmed) || /<<\s*\w+/.test(trimmed)

  // Strong command indicators
  if (isScript || (isMultiline && firstCommand)) {
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: 'Multi-line bash script or control structure detected',
      ambiguous: false,
    }
  }

  // Strong intent indicators: questions and conversational patterns
  if (questionLike || conversational) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: nlIndicatorCount >= 2 ? 0.9 : 0.85,
      input: trimmed,
      reason: questionLike
        ? 'Question-like input detected'
        : 'Conversational pattern detected',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Single word handling
  if (wordCount === 1) {
    const word = trimmed.toLowerCase()
    const isKnownCommand = BASH_COMMANDS.has(word)
    const isAmbiguous = isSingleWordAmbiguous(word)

    if (isAmbiguous) {
      // pwd is more command-like than list
      const isPureCommand = ['pwd', 'cd', 'ls', 'cat', 'echo', 'date', 'cal', 'uptime', 'whoami'].includes(word)
      const confidence = isPureCommand ? 0.7 : 0.5
      const type = isKnownCommand ? 'command' : 'intent'

      return {
        type,
        confidence,
        input: trimmed,
        reason: `Single word "${word}" could be interpreted as ${isKnownCommand ? 'command or' : ''} natural language`,
        ambiguous: true,
        alternatives: [
          { type: 'command', interpretation: `${word} (if command exists)` },
          { type: 'intent', interpretation: isKnownCommand ? `Execute ${word} command` : `${word} files or items` },
        ],
      }
    }

    // Known command but not ambiguous (less common single-word commands)
    if (isKnownCommand) {
      return {
        type: 'command',
        confidence: 0.75,
        input: trimmed,
        reason: `"${word}" is a known bash command`,
        ambiguous: true,
        alternatives: [
          { type: 'command', interpretation: `${word} command` },
          { type: 'intent', interpretation: `Action related to ${word}` },
        ],
      }
    }

    // Unknown single word - likely intent
    return {
      type: 'intent',
      confidence: 0.6,
      input: trimmed,
      reason: `Single word "${word}" interpreted as natural language`,
      ambiguous: true,
      alternatives: [
        { type: 'command', interpretation: `${word} (if command exists)` },
        { type: 'intent', interpretation: `Natural language request` },
      ],
    }
  }

  // Multi-word with clear command syntax (pipes, flags, redirects)
  if (hasShellSyntax) {
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: 'Contains bash syntax elements (pipes, redirects, flags, or shell constructs)',
      ambiguous: false,
    }
  }

  // Starts with known command and has arguments
  if (firstCommand && wordCount >= 2) {
    // Check if rest looks like natural language
    const restOfInput = words.slice(1).join(' ')
    const restNlCount = countNaturalLanguageIndicators(restOfInput)

    // "cat the config file please" - command word but natural language
    if (restNlCount >= 2 || /\b(the|a|an|please|all)\b/i.test(restOfInput)) {
      const suggested = suggestCommand(trimmed)
      return {
        type: 'intent',
        confidence: 0.8,
        input: trimmed,
        reason: `Starts with command "${firstCommand}" but rest appears to be natural language`,
        ambiguous: false,
        suggestedCommand: suggested,
      }
    }

    // Check if arguments look like natural language rather than command args
    // Natural language args: adjectives like "large", "big", "small", "old", "new"
    // Natural language args: plural nouns like "files", "directories", "folders"
    // Command args: flags like "-l", paths like ".", or filenames
    const naturalLanguageArgs = /\b(large|big|small|old|new|recent|latest|oldest|newest|empty|hidden|modified|changed|created|deleted)\b/i
    const looksLikePath = /^[.~\/]|\/|\.[a-z]+$/i
    const restWords = words.slice(1)
    const hasNaturalArgs = naturalLanguageArgs.test(restOfInput)
    const hasPathLikeArgs = restWords.some(w => looksLikePath.test(w) || w.startsWith('-'))

    if (hasNaturalArgs && !hasPathLikeArgs) {
      const suggested = suggestCommand(trimmed)
      return {
        type: 'intent',
        confidence: 0.85,
        input: trimmed,
        reason: `Starts with command "${firstCommand}" but arguments appear to be natural language`,
        ambiguous: false,
        suggestedCommand: suggested,
      }
    }

    // Looks like a proper command
    return {
      type: 'command',
      confidence: 0.95,
      input: trimmed,
      reason: `Valid command "${firstCommand}" with arguments`,
      ambiguous: false,
    }
  }

  // High natural language indicator count
  if (nlIndicatorCount >= 2) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: 0.85,
      input: trimmed,
      reason: 'Multiple natural language indicators detected',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Default: looks like natural language if no command patterns found
  if (!firstCommand && wordCount >= 2) {
    const suggested = suggestCommand(trimmed)
    return {
      type: 'intent',
      confidence: 0.8,
      input: trimmed,
      reason: 'Multi-word input without command syntax',
      ambiguous: false,
      suggestedCommand: suggested,
    }
  }

  // Fallback for edge cases
  return {
    type: 'intent',
    confidence: 0.6,
    input: trimmed,
    reason: 'Unable to determine type with high confidence',
    ambiguous: true,
    alternatives: [
      { type: 'command', interpretation: 'Possible command' },
      { type: 'intent', interpretation: 'Natural language request' },
    ],
  }
}
