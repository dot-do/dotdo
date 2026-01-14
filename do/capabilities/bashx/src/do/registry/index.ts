/**
 * Command Registry Module
 *
 * Provides centralized command metadata management for the tiered execution model.
 * Commands are registered with tier, handler, and capabilities information.
 *
 * @packageDocumentation
 * @module registry
 */

export {
  CommandRegistry,
  type CommandMetadata,
  type CommandCapability,
  type CommandHandler,
} from './command-registry.js'
