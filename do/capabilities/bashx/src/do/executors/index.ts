/**
 * Executor Modules
 *
 * This module provides the building blocks for the tiered execution system.
 * There are two distinct executor interfaces:
 *
 * 1. TierExecutor - For bash command execution (Tiers 1-4)
 * 2. LanguageExecutor - For polyglot language execution (PolyglotExecutor)
 *
 * Architecture:
 * -------------
 * - types.ts: Interfaces (TierExecutor, LanguageExecutor) and type definitions
 * - native-executor.ts: Tier 1 - In-Worker native commands (TierExecutor)
 * - rpc-executor.ts: Tier 2 - RPC service calls (TierExecutor)
 * - loader-executor.ts: Tier 3 - Dynamic npm module loading (TierExecutor)
 * - sandbox-executor.ts: Tier 4 - Full Linux sandbox (TierExecutor)
 * - polyglot-executor.ts: Language runtimes via RPC (LanguageExecutor)
 *
 * Interface Separation:
 * --------------------
 * TierExecutor and LanguageExecutor are separate interfaces because they
 * have different contracts:
 * - TierExecutor.canExecute(command: string)
 * - LanguageExecutor.canExecute(language: SupportedLanguage)
 *
 * This follows the Liskov Substitution Principle - they cannot be
 * interchanged without breaking type safety.
 *
 * Dependency Rules:
 * -----------------
 * 1. All executors import from types.ts (this directory) and ../../types.js
 * 2. No executor imports from another executor (prevents circular deps)
 * 3. TieredExecutor imports executors, not the reverse
 *
 * Usage:
 * ------
 * ```typescript
 * import {
 *   TierExecutor,
 *   LanguageExecutor,
 *   NativeExecutor,
 *   RpcExecutor,
 *   LoaderExecutor,
 *   SandboxExecutor,
 *   PolyglotExecutor,
 * } from './executors/index.js'
 * ```
 *
 * @module bashx/do/executors
 */

// ============================================================================
// SHARED TYPES
// ============================================================================

export type {
  TierExecutor,
  LanguageExecutor,
  SupportedLanguage,
  ExecutionTier,
  TierClassification,
  CommandResult,
  ExtendedCommandResult,
  CapabilityAware,
  CommandAware,
  BaseExecutorConfig,
  ExecutorFactory,
} from './types.js'

// ============================================================================
// TIER 1: NATIVE IN-WORKER EXECUTION
// ============================================================================
// Handles commands that can be executed natively without external services:
// - Filesystem ops via FsCapability
// - HTTP via fetch API
// - Data processing (jq, base64, etc.)
// - POSIX utilities
//
// Tier1Executor is the canonical facade for Tier 1 execution.
// NativeExecutor is the underlying implementation.
// ============================================================================

// Tier1Executor - The canonical Tier 1 executor facade
export {
  Tier1Executor,
  createTier1Executor,
  type Tier1ExecutorConfig,
  type Tier1Capability,
  // Tier 1 command sets
  TIER1_COMMANDS,
  TIER1_FS_COMMANDS,
  TIER1_HTTP_COMMANDS,
  TIER1_DATA_COMMANDS,
  TIER1_CRYPTO_COMMANDS,
  TIER1_TEXT_COMMANDS,
  TIER1_POSIX_COMMANDS,
  TIER1_SYSTEM_COMMANDS,
  TIER1_EXTENDED_COMMANDS,
} from './tier1-executor.js'

// NativeExecutor - Underlying implementation (backward compatibility)
export {
  NativeExecutor,
  createNativeExecutor,
  type NativeExecutorConfig,
  type NativeCapability,
  type NativeCommandResult,
  // Command sets
  NATIVE_COMMANDS,
  FS_COMMANDS,
  HTTP_COMMANDS,
  DATA_COMMANDS,
  CRYPTO_COMMANDS,
  TEXT_PROCESSING_COMMANDS,
  POSIX_UTILS_COMMANDS,
  SYSTEM_UTILS_COMMANDS,
  EXTENDED_UTILS_COMMANDS,
} from './native-executor.js'

// ============================================================================
// TIER 2: RPC SERVICE EXECUTION
// ============================================================================
// Handles commands via RPC calls to external services:
// - jq.do for complex jq processing
// - npm.do for npm/npx/yarn/pnpm/bun commands
// - git.do for git operations
// - Custom RPC service bindings
// ============================================================================
export {
  RpcExecutor,
  createRpcExecutor,
  type RpcExecutorConfig,
  type RpcEndpoint,
  type RpcServiceBinding,
  type RpcRequestPayload,
  type RpcResponsePayload,
  DEFAULT_RPC_SERVICES,
} from './rpc-executor.js'

// ============================================================================
// TIER 3: DYNAMIC NPM MODULE LOADING
// ============================================================================
// Handles commands via dynamically loaded npm modules:
// - JavaScript tools (esbuild, typescript, prettier, eslint)
// - Data processing (yaml, toml, zod, ajv)
// - Crypto (crypto-js, jose)
// - Utilities (lodash, date-fns, uuid)
// ============================================================================
export {
  LoaderExecutor,
  createLoaderExecutor,
  type LoaderExecutorConfig,
  type ModuleLoader,
  type WorkerLoaderBinding,
  type ModuleExecutionResult,
  type LoadableModule,
  LOADABLE_MODULES,
  MODULE_CATEGORIES,
} from './loader-executor.js'

// ============================================================================
// TIER 3: JAVASCRIPT/TYPESCRIPT EXECUTION
// ============================================================================
// Handles inline JavaScript/TypeScript execution:
// - node -e "code" - Execute inline JavaScript
// - bun -e "code" - Execute inline JavaScript (bun syntax)
// - tsx -e "code" - Execute TypeScript
// - esm run @scope/module - Execute esm.do module
//
// Security guarantees:
// - V8 isolate sandbox (ai-evaluate)
// - No filesystem access
// - No network by default
// - CPU/memory limits
// ============================================================================
export {
  JsExecutor,
  createJsExecutor,
  type JsExecutorConfig,
  type JsEvaluator,
  type JsEvaluationResult,
  JS_COMMANDS,
} from './js-executor.js'

// ============================================================================
// TIER 4: FULL LINUX SANDBOX
// ============================================================================
// Handles commands requiring full Linux environment:
// - System commands (ps, top, kill, etc.)
// - Process management
// - Compilers and runtimes (gcc, python, node, etc.)
// - Container operations
// - Any command not handled by higher tiers
// ============================================================================
export {
  SandboxExecutor,
  createSandboxExecutor,
  type SandboxExecutorConfig,
  type SandboxBackend,
  type SandboxBinding,
  type SandboxSession,
  type SandboxCapability,
  type SandboxResult,
  SANDBOX_COMMANDS,
  SANDBOX_CATEGORIES,
} from './sandbox-executor.js'

// ============================================================================
// POLYGLOT: LANGUAGE-SPECIFIC EXECUTION
// ============================================================================
// Handles execution via language-specific warm runtime workers:
// - pyx.do for Python
// - ruby.do for Ruby
// - node.do for Node.js
// - go.do for Go
// - rust.do for Rust
//
// Note: PolyglotExecutor implements LanguageExecutor, NOT TierExecutor.
// This is because it has a different interface contract:
// - canExecute(language) instead of canExecute(command)
// - execute(command, language, options) instead of execute(command, options)
// ============================================================================
export {
  PolyglotExecutor,
  createPolyglotExecutor,
  type PolyglotExecutorConfig,
  type LanguageBinding,
  type PolyglotRequestPayload,
  type PolyglotResponsePayload,
  DEFAULT_LANGUAGE_SERVICES,
} from './polyglot-executor.js'
