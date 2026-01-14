/**
 * Type declarations for external and submodule packages.
 *
 * These declarations provide minimal types for packages that are either:
 * - External submodules with their own build systems (bashx, fsx, primitives)
 * - External npm packages that may not be installed
 * - Compat layer packages that live in a separate repo
 *
 * @module types/modules
 */

// =============================================================================
// BASHX - Shell execution capability (submodule)
// =============================================================================

declare module 'bashx.do' {
  export interface BashResult {
    stdout: string
    stderr: string
    exitCode: number
    duration: number
  }

  export interface ExecOptions {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    input?: string
  }

  export interface SpawnOptions extends ExecOptions {
    shell?: boolean
  }

  export interface SpawnHandle {
    pid: number
    stdin: WritableStream<Uint8Array>
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    kill: (signal?: number) => void
    wait: () => Promise<BashResult>
  }

  export interface Program {
    name: string
    args: string[]
    raw: string
  }

  export type SafetyClassification =
    | 'safe'
    | 'unsafe'
    | 'dangerous'
    | 'requires_review'

  export type Intent =
    | 'read'
    | 'write'
    | 'execute'
    | 'network'
    | 'system'
    | 'unknown'

  export interface SafetyAnalysis {
    classification: SafetyClassification
    intents: Intent[]
    risks: string[]
    suggestions?: string[]
  }

  export interface DangerCheck {
    isDangerous: boolean
    reasons: string[]
  }

  export interface BashCapability {
    exec(cmd: string, args?: string[], options?: ExecOptions): Promise<BashResult>
    run(cmd: string, options?: ExecOptions): Promise<BashResult>
    spawn(cmd: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
    parse(script: string): Program[]
    analyze(script: string): SafetyAnalysis
    isDangerous(script: string): DangerCheck
  }
}

declare module 'bashx.do/do' {
  import type { BashResult, ExecOptions, SpawnOptions, SpawnHandle, BashCapability } from 'bashx.do'

  export interface BashExecutor {
    execute(cmd: string, options?: ExecOptions): Promise<BashResult>
  }

  export interface BashModuleOptions {
    executor?: BashExecutor
  }

  export interface WithBashConfig {
    executor?: () => BashExecutor
  }

  export interface ContainerStub {
    execute(cmd: string, options?: ExecOptions): Promise<BashResult>
  }

  export type GetContainerFn = () => Promise<ContainerStub>

  export interface ContainerExecutorConfig {
    getContainer: GetContainerFn
    timeout?: number
  }

  export class BashModule implements BashCapability {
    constructor(options?: BashModuleOptions)
    exec(cmd: string, args?: string[], options?: ExecOptions): Promise<BashResult>
    run(cmd: string, options?: ExecOptions): Promise<BashResult>
    spawn(cmd: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
    parse(script: string): import('bashx.do').Program[]
    analyze(script: string): import('bashx.do').SafetyAnalysis
    isDangerous(script: string): import('bashx.do').DangerCheck
  }

  export class CloudflareContainerExecutor implements BashExecutor {
    constructor(config: ContainerExecutorConfig)
    execute(cmd: string, options?: ExecOptions): Promise<BashResult>
  }

  export function createContainerExecutor(config: ContainerExecutorConfig): BashExecutor
  export function createSessionContainerExecutor(config: ContainerExecutorConfig): BashExecutor
}

// =============================================================================
// FSX - File system capability (submodule)
// =============================================================================

declare module 'fsx.do' {
  export interface FsxResult {
    success: boolean
    path: string
  }

  export interface ReadResult extends FsxResult {
    content: string
  }

  export interface WriteResult extends FsxResult {
    bytesWritten: number
  }

  export interface FsxCapability {
    read(path: string): Promise<ReadResult>
    write(path: string, content: string): Promise<WriteResult>
    exists(path: string): Promise<boolean>
    mkdir(path: string, options?: { recursive?: boolean }): Promise<FsxResult>
    rm(path: string, options?: { recursive?: boolean }): Promise<FsxResult>
    readdir(path: string): Promise<string[]>
    stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number }>
  }
}

// =============================================================================
// AI PACKAGES (primitives submodule)
// =============================================================================

declare module 'ai-database' {
  export interface Database {
    query(sql: string): Promise<unknown[]>
    execute(sql: string): Promise<void>
  }
}

declare module 'ai-functions' {
  export function generate<T>(prompt: string): Promise<T>
  export function stream<T>(prompt: string): AsyncIterable<T>
}

declare module 'ai-evaluate' {
  export interface EvalResult {
    score: number
    passed: boolean
  }
  export function evaluate(input: string, expected: string): EvalResult
}

declare module 'ai-providers' {
  export interface Provider {
    name: string
    generate(prompt: string): Promise<string>
  }
}

declare module 'ai-providers/cloudflare' {
  export const cloudflareProvider: import('ai-providers').Provider
}

// =============================================================================
// COMPAT PACKAGES (separate repo)
// =============================================================================

declare module '../../../compat/slack' {
  export interface SlackClient {
    postMessage(channel: string, text: string): Promise<void>
  }
  export function createSlackClient(token: string): SlackClient
}

declare module '../../../compat/stripe' {
  export interface StripeClient {
    createPaymentIntent(amount: number, currency: string): Promise<{ id: string }>
  }
  export function createStripeClient(key: string): StripeClient
}

declare module '../../../compat/sendgrid' {
  export interface SendGridClient {
    sendEmail(to: string, subject: string, body: string): Promise<void>
  }
  export function createSendGridClient(key: string): SendGridClient
}

// =============================================================================
// PRIMITIVES PATHS (excluded from compilation)
// =============================================================================

declare module '../../../primitives/fsx/core/glob' {
  export interface GlobOptions {
    cwd?: string
    ignore?: string[]
  }
  export function glob(pattern: string, options?: GlobOptions): Promise<string[]>
}

declare module '../../../primitives/fsx/core/fsx' {
  export interface Fsx {
    read(path: string): Promise<string>
    write(path: string, content: string): Promise<void>
    exists(path: string): Promise<boolean>
  }
}

declare module '../../../primitives/bashx/src/do/tiered-executor' {
  export interface TieredExecutor {
    execute(cmd: string): Promise<{ stdout: string; exitCode: number }>
  }
  export function createTieredExecutor(): TieredExecutor
}

declare module '../../../primitives/bashx/src/types' {
  export interface BashOptions {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
  }
}

// =============================================================================
// NPM PACKAGES (may not be installed)
// =============================================================================

declare module 'nanoid' {
  export function nanoid(size?: number): string
}

declare module 'pako' {
  export function deflate(data: Uint8Array): Uint8Array
  export function inflate(data: Uint8Array): Uint8Array
}

declare module '@ai-sdk/cloudflare' {
  export const cloudflare: {
    chat(model: string): unknown
  }
}

declare module '@mdx-js/mdx' {
  export function compile(source: string): Promise<{ toString(): string }>
}

declare module 'tsup' {
  export interface Options {
    entry: string[]
    format: string[]
    dts?: boolean
    clean?: boolean
  }
  export function defineConfig(options: Options): Options
}

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string)
    query(sql: string): { all(): unknown[]; run(): void }
    close(): void
  }
}

declare module 'rpc.do' {
  export interface RpcClient {
    call(method: string, params: unknown): Promise<unknown>
  }
}

// =============================================================================
// SQL MIGRATIONS (raw SQL files)
// =============================================================================

declare module './0000_gray_revanche.sql' {
  const content: string
  export default content
}

declare module './0001_solid_slayback.sql' {
  const content: string
  export default content
}

declare module './0002_stiff_red_hulk.sql' {
  const content: string
  export default content
}
