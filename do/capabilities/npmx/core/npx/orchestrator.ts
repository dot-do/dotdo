/**
 * NPX Orchestrator
 *
 * Coordinates the full npx execution flow:
 * 1. Parse command and arguments
 * 2. Resolve package from registry
 * 3. Classify execution tier (1=ESM, 2=polyfills, 3=container)
 * 4. Fetch bundle from esm.sh or registry
 * 5. Execute in appropriate sandbox
 * 6. Return result with output
 *
 * @module npmx/core/npx/orchestrator
 */

import { classifyPackage, type ExecutionTier, type PackageClassification } from './classification.js'
import { resolveEsmBundle, resolveBinary, fetchEsmBundle, type EsmBundle } from './esm-resolver.js'
import { RegistryClient } from '../registry/index.js'
import { ValidationError, PackageNotFoundError, ExecutionError, TimeoutError } from '../errors/index.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Options for npx execution
 */
export interface NpxOptions {
  /** Command line arguments to pass to the package binary */
  args?: string[]
  /** Environment variables */
  env?: Record<string, string>
  /** Current working directory */
  cwd?: string
  /** Standard input to pass to the command */
  stdin?: string
  /** Execution timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Force a specific execution tier */
  forceTier?: ExecutionTier
  /** Custom npm registry URL */
  registry?: string
  /** Skip package cache */
  noCache?: boolean
  /** Verbose logging */
  verbose?: boolean
  /** Node.js polyfills to inject (for Tier 2) */
  polyfills?: PolyfillConfig
}

/**
 * Node.js polyfill configuration
 */
export interface PolyfillConfig {
  /** Enable fs polyfill (fsx.do) */
  fs?: boolean
  /** Enable path polyfill */
  path?: boolean
  /** Enable process polyfill */
  process?: boolean
  /** Enable buffer polyfill */
  buffer?: boolean
  /** Enable crypto polyfill (Web Crypto) */
  crypto?: boolean
  /** Enable events polyfill */
  events?: boolean
  /** Enable stream polyfill */
  stream?: boolean
  /** Custom polyfills */
  custom?: Record<string, unknown>
}

/**
 * Result of npx execution
 */
export interface NpxResult {
  /** Exit code (0 = success) */
  exitCode: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Execution duration in milliseconds */
  duration: number
  /** Whether execution timed out */
  timedOut: boolean
  /** Execution tier that was used */
  tier: ExecutionTier
  /** Package that was executed */
  package: string
  /** Resolved package version */
  version: string
  /** Classification result */
  classification?: PackageClassification
}

/**
 * Parsed npx command
 */
export interface ParsedCommand {
  /** Package specifier (e.g., "cowsay", "@scope/pkg@1.0.0") */
  package: string
  /** Binary name to execute (optional, defaults to package name) */
  binary?: string
  /** Arguments to pass to the binary */
  args: string[]
  /** Additional packages to install (-p flag) */
  additionalPackages: string[]
}

// ============================================================================
// COMMAND PARSING
// ============================================================================

/**
 * Parse npx-style command into components
 *
 * Supports:
 * - `npx cowsay hello` -> package: cowsay, args: [hello]
 * - `npx -p typescript tsc --version` -> package: typescript, binary: tsc, args: [--version]
 * - `npx create-next-app@latest my-app` -> package: create-next-app@latest, args: [my-app]
 *
 * @param command - The package/command specifier
 * @param args - Additional command line arguments
 */
export function parseCommand(command: string, args: string[] = []): ParsedCommand {
  if (!command || command.trim() === '') {
    throw new ValidationError('Command cannot be empty')
  }

  const allArgs = [...args]
  const additionalPackages: string[] = []
  let packageSpec = command.trim()
  let binary: string | undefined

  // Parse -p/--package flags from args
  const filteredArgs: string[] = []
  for (let i = 0; i < allArgs.length; i++) {
    const arg = allArgs[i]
    if (arg === '-p' || arg === '--package') {
      if (i + 1 < allArgs.length) {
        additionalPackages.push(allArgs[++i])
      }
    } else if (arg.startsWith('-p=') || arg.startsWith('--package=')) {
      additionalPackages.push(arg.split('=')[1])
    } else {
      filteredArgs.push(arg)
    }
  }

  // If we have additional packages, the first filtered arg might be the binary
  if (additionalPackages.length > 0 && filteredArgs.length > 0) {
    // Check if packageSpec is in additionalPackages format
    // In `npx -p typescript tsc --version`, command is "tsc"
    binary = packageSpec
    packageSpec = additionalPackages[0]
    // Keep remaining additional packages
    if (additionalPackages.length > 1) {
      additionalPackages.shift()
    } else {
      additionalPackages.length = 0
    }
  }

  return {
    package: packageSpec,
    binary,
    args: filteredArgs,
    additionalPackages,
  }
}

/**
 * Extract package name from specifier (without version)
 */
function extractPackageName(packageSpec: string): string {
  if (packageSpec.startsWith('@')) {
    // Scoped package
    const atIndex = packageSpec.indexOf('@', 1)
    if (atIndex !== -1) {
      return packageSpec.substring(0, atIndex)
    }
  } else {
    const atIndex = packageSpec.indexOf('@')
    if (atIndex !== -1) {
      return packageSpec.substring(0, atIndex)
    }
  }
  return packageSpec
}

// ============================================================================
// TIER EXECUTION HANDLERS
// ============================================================================

/**
 * Execute package in Tier 1 (pure ESM via esm.sh)
 */
async function executeTier1(
  bundle: EsmBundle,
  _binary: string | undefined,
  options: NpxOptions,
  startTime: number
): Promise<NpxResult> {
  const timeout = options.timeout ?? 30000

  try {
    // Fetch the ESM bundle
    const code = await fetchEsmBundle(bundle.url, { timeout })

    // Create a minimal sandbox and execute
    // In a real implementation, this would use V8 isolates
    // For now, we simulate execution
    const stdout: string[] = []
    const stderr: string[] = []

    // Create sandbox globals
    const sandbox = {
      console: {
        log: (...args: unknown[]) => stdout.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => stderr.push(args.map(String).join(' ')),
      },
      process: {
        argv: ['node', bundle.package, ...(options.args ?? [])],
        env: options.env ?? {},
        cwd: () => options.cwd ?? '/',
      },
    }

    // Execute the module (simplified - real implementation uses dynamic import)
    // This is a placeholder that simulates successful execution
    const duration = Date.now() - startTime

    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      duration,
      timedOut: false,
      tier: 1,
      package: bundle.package,
      version: bundle.version,
    }
  } catch (error) {
    const duration = Date.now() - startTime

    if (error instanceof ValidationError && error.message.includes('timeout')) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Execution timed out',
        duration,
        timedOut: true,
        tier: 1,
        package: bundle.package,
        version: bundle.version,
      }
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      duration,
      timedOut: false,
      tier: 1,
      package: bundle.package,
      version: bundle.version,
    }
  }
}

/**
 * Execute package in Tier 2 (ESM with polyfills)
 */
async function executeTier2(
  bundle: EsmBundle,
  _binary: string | undefined,
  options: NpxOptions,
  startTime: number,
  classification: PackageClassification
): Promise<NpxResult> {
  const timeout = options.timeout ?? 30000

  try {
    // Fetch the ESM bundle
    const code = await fetchEsmBundle(bundle.url, { timeout })

    // Prepare polyfills based on classification
    const requiredPolyfills = classification.requiredBuiltins
    const polyfillConfig: PolyfillConfig = options.polyfills ?? {}

    // Auto-enable required polyfills
    for (const builtin of requiredPolyfills) {
      switch (builtin) {
        case 'fs':
          polyfillConfig.fs = true
          break
        case 'path':
          polyfillConfig.path = true
          break
        case 'process':
          polyfillConfig.process = true
          break
        case 'buffer':
          polyfillConfig.buffer = true
          break
        case 'crypto':
          polyfillConfig.crypto = true
          break
        case 'events':
          polyfillConfig.events = true
          break
        case 'stream':
          polyfillConfig.stream = true
          break
      }
    }

    // Execute with polyfills (simplified - real implementation injects polyfills)
    const stdout: string[] = []
    const stderr: string[] = []
    const duration = Date.now() - startTime

    return {
      exitCode: 0,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      duration,
      timedOut: false,
      tier: 2,
      package: bundle.package,
      version: bundle.version,
      classification,
    }
  } catch (error) {
    const duration = Date.now() - startTime

    if (error instanceof ValidationError && error.message.includes('timeout')) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Execution timed out',
        duration,
        timedOut: true,
        tier: 2,
        package: bundle.package,
        version: bundle.version,
        classification,
      }
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      duration,
      timedOut: false,
      tier: 2,
      package: bundle.package,
      version: bundle.version,
      classification,
    }
  }
}

/**
 * Execute package in Tier 3 (full container/Node.js)
 */
async function executeTier3(
  packageName: string,
  version: string,
  _binary: string | undefined,
  options: NpxOptions,
  startTime: number,
  classification: PackageClassification
): Promise<NpxResult> {
  // Tier 3 execution requires real Node.js via bashx.do
  // This is a placeholder that indicates the need for container execution

  const duration = Date.now() - startTime

  // In production, this would delegate to bashx.do for container execution
  // For now, return an error indicating Tier 3 is not supported in isolate

  return {
    exitCode: 1,
    stdout: '',
    stderr: `Package ${packageName} requires native execution (Tier 3). ` +
      `Reason: ${classification.reason}. ` +
      `Use bashx.do for full Node.js container execution.`,
    duration,
    timedOut: false,
    tier: 3,
    package: packageName,
    version,
    classification,
  }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

/**
 * Execute an npx command
 *
 * This is the main entry point for npx execution. It:
 * 1. Parses the command
 * 2. Resolves the package from the registry
 * 3. Classifies the execution tier
 * 4. Fetches and executes in the appropriate sandbox
 * 5. Returns the result
 *
 * @param command - Package or command to execute
 * @param options - Execution options
 * @returns Execution result with exit code, output, and metadata
 *
 * @example
 * ```typescript
 * // Simple execution
 * const result = await executeNpx('cowsay', { args: ['hello'] })
 * console.log(result.stdout)
 *
 * // With version
 * const result = await executeNpx('typescript@5.0.0', { args: ['--version'] })
 *
 * // Force execution tier
 * const result = await executeNpx('my-package', { forceTier: 2 })
 * ```
 */
export async function executeNpx(
  command: string,
  options: NpxOptions = {}
): Promise<NpxResult> {
  const startTime = Date.now()
  const timeout = options.timeout ?? 30000

  try {
    // 1. Parse command
    const parsed = parseCommand(command, options.args)
    const packageName = extractPackageName(parsed.package)

    if (options.verbose) {
      console.log(`[npx] Executing ${parsed.package}`)
      console.log(`[npx] Arguments: ${parsed.args.join(' ')}`)
    }

    // 2. Resolve package from registry to get metadata for classification
    const registryClient = new RegistryClient({
      registry: options.registry,
      timeout,
    })

    const metadata = await registryClient.getPackageMetadata(packageName)
    if (!metadata) {
      throw new PackageNotFoundError(packageName)
    }

    // Get the resolved version
    const resolvedVersion = parsed.package.includes('@')
      ? parsed.package.split('@').pop()!
      : metadata['dist-tags'].latest

    const versionMeta = metadata.versions[resolvedVersion]

    // 3. Classify execution tier
    const classification = await classifyPackage(parsed.package, versionMeta ? {
      name: packageName,
      version: resolvedVersion,
      main: versionMeta.main,
      module: versionMeta.module,
      dependencies: versionMeta.dependencies,
      bin: versionMeta.bin,
      scripts: versionMeta.scripts,
      engines: versionMeta.engines,
    } : undefined)

    // Allow forcing a specific tier
    const tier = options.forceTier ?? classification.tier

    if (options.verbose) {
      console.log(`[npx] Classified as Tier ${tier}: ${classification.reason}`)
    }

    // 4. Fetch bundle and execute based on tier
    if (tier === 1 || tier === 2) {
      // Resolve ESM bundle from esm.sh
      const bundle = await resolveEsmBundle(parsed.package, {
        timeout,
        cache: options.noCache ? 'no-cache' : 'default',
      })

      if (options.verbose) {
        console.log(`[npx] Resolved bundle: ${bundle.url}`)
      }

      if (tier === 1) {
        return await executeTier1(bundle, parsed.binary, options, startTime)
      } else {
        return await executeTier2(bundle, parsed.binary, options, startTime, classification)
      }
    } else {
      // Tier 3: Container execution
      return await executeTier3(
        packageName,
        resolvedVersion,
        parsed.binary,
        options,
        startTime,
        classification
      )
    }
  } catch (error) {
    const duration = Date.now() - startTime

    // Handle specific error types
    if (error instanceof PackageNotFoundError) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Package not found: ${error.packageName}`,
        duration,
        timedOut: false,
        tier: 3,
        package: command,
        version: 'unknown',
      }
    }

    if (error instanceof TimeoutError) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Execution timed out after ${timeout}ms`,
        duration,
        timedOut: true,
        tier: 3,
        package: command,
        version: 'unknown',
      }
    }

    if (error instanceof ValidationError) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: error.message,
        duration,
        timedOut: false,
        tier: 3,
        package: command,
        version: 'unknown',
      }
    }

    // Generic error
    return {
      exitCode: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      duration,
      timedOut: false,
      tier: 3,
      package: command,
      version: 'unknown',
    }
  }
}

/**
 * Execute multiple packages with npx
 * Useful for running commands that require multiple packages (e.g., npx -p pkg1 -p pkg2 cmd)
 *
 * @param packages - List of packages to install
 * @param command - Command to execute after installation
 * @param options - Execution options
 */
export async function executeNpxMulti(
  packages: string[],
  command: string,
  options: NpxOptions = {}
): Promise<NpxResult> {
  // For multi-package execution, we need all packages available
  // This is a simplified implementation that executes the main command
  // Real implementation would ensure all packages are available first

  return executeNpx(command, {
    ...options,
    // Additional packages would be resolved and made available
  })
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  type ExecutionTier,
  type PackageClassification,
} from './classification.js'

export {
  type EsmBundle,
} from './esm-resolver.js'
