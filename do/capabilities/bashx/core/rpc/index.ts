/**
 * Shell RPC Module
 *
 * Exports types and interfaces for remote shell execution via Cap'n Web RPC.
 *
 * @packageDocumentation
 */

export type {
  // Result types
  ShellResult,
  ShellExecOptions,
  ShellSpawnOptions,
  // Stream types
  ShellStream,
  ShellDataCallback,
  ShellExitCallback,
  // API interface
  ShellApi,
} from './types.js'
